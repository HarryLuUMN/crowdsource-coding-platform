const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = process.env.STUDIO_URL || "http://127.0.0.1:8136";
const root = path.join(__dirname, "..");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "idyll-browser-"));
  const browser = spawn(chrome, ["--headless=new", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${directory}`, "--remote-debugging-port=0", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let log = "";
      const timeout = setTimeout(() => reject(new Error("Chrome did not start")), 15000);
      browser.stderr.on("data", data => {
        log += data;
        const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      browser.on("error", reject);
    });
    socket = new WebSocket(endpoint);
    await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
    let nextId = 0;
    const pending = new Map();
    const contexts = [];
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timeout);
        message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
      } else if (message.method === "Runtime.executionContextCreated") {
        contexts.push({ ...message.params.context, session: message.sessionId });
      } else if (message.method === "Target.attachedToTarget") {
        send("Runtime.enable", {}, message.params.sessionId).catch(() => {});
      }
    });
    const { targetId } = await send("Target.createTarget", { url: `${base}/?preview=1&task=idyll-playground-v1` });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId);
    await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
    const evaluate = async (expression, context) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, ...(context ? { contextId: context.id } : {}) }, context?.session || sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ": " + result.exceptionDetails.exception?.description);
      return result.result.value;
    };
    await delay(1000);
    await evaluate("window.previewMessages=[]; window.addEventListener('message', e => window.previewMessages.push(e.data)); const smokeFrame=document.createElement('iframe'); smokeFrame.id='smoke-frame'; smokeFrame.sandbox='allow-scripts'; smokeFrame.src='/idyll-preview.html'; document.body.append(smokeFrame);");
    let preview;
    for (let attempt = 0; attempt < 40 && !preview; attempt++) {
      await delay(100);
      for (const context of contexts.filter(context => context.auxData?.isDefault)) {
        try {
          if (await evaluate("location.pathname === '/idyll-preview.html' && typeof ReactDOM === 'undefined' && !!document.querySelector('#article')", context)) preview = context;
        } catch (_) {}
      }
    }
    assert.ok(preview, "Preview frame execution context exists");
    const compile = source => {
      const result = spawnSync("node", [path.join(root, "scripts/idyll_compile.cjs")], { input: JSON.stringify({ source }), encoding: "utf8" });
      const output = JSON.parse(result.stdout);
      assert.equal(output.ok, true, JSON.stringify(output.error));
      return output.ast;
    };
    const ast = compile('[var name:"quantity" value:2 /]\n# Calculator\n[Range value:quantity min:0 max:10 /]\n[Display value:`quantity * 3` /]');
    await evaluate(`document.querySelector('#smoke-frame').contentWindow.postMessage({type:'idyll.render',ast:${JSON.stringify(ast)}},'*')`);
    await delay(500);
    assert.equal(await evaluate("!!document.querySelector('input[type=range]')", preview), true, "Real Range component renders");
    assert.match(await evaluate("document.querySelector('#article').textContent", preview), /6/);
    await evaluate("const slider=document.querySelector('input[type=range]'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(slider,'4'); slider.dispatchEvent(new Event('input',{bubbles:true})); slider.dispatchEvent(new Event('change',{bubbles:true}));", preview);
    await delay(200);
    assert.match(await evaluate("document.querySelector('#article').textContent", preview), /12/, "Reactive expressions update");
    assert.equal(await evaluate("try { localStorage.getItem('test'); false } catch(e) { e.name === 'SecurityError' }", preview), true, "Preview has opaque origin");
    assert.equal(await evaluate("fetch('/api/health').then(()=>false).catch(()=>true)", preview), true, "Preview cannot fetch application APIs");
    const conditionalSource = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/structured_solutions.json'), 'utf8'))['idyll-conditional-v1'];
    const conditionalAst = compile(conditionalSource);
    await evaluate(`document.querySelector('#smoke-frame').contentWindow.postMessage({type:'idyll.render',ast:${JSON.stringify(conditionalAst)}},'*')`);
    await delay(300);
    for (const [value, expected] of [[0, 'Low'], [29, 'Low'], [30, 'Medium'], [69, 'Medium'], [70, 'High'], [100, 'High']]) {
      await evaluate(`(()=>{const slider=document.querySelector('input[type=range]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(slider,${JSON.stringify(String(value))}); slider.dispatchEvent(new Event('input',{bubbles:true})); slider.dispatchEvent(new Event('change',{bubbles:true}));})()`, preview);
      await delay(100);
      const visible = await evaluate("document.querySelector('#article').innerText", preview);
      assert.match(visible, new RegExp(expected), 'Conditional preview displays the correct range label');
      for (const other of ['Low', 'Medium', 'High'].filter(label => label !== expected)) assert.ok(!visible.includes(other), 'Inactive conditional labels stay hidden');
      assert.ok(!visible.includes('Could not find an implementation'), 'Built-in components resolve regardless of module export style');
    }
    const badAst = compile('[Display value:`missingVariable + 1` /]');
    await evaluate(`document.querySelector('#smoke-frame').contentWindow.postMessage({type:'idyll.render',ast:${JSON.stringify(badAst)}},'*')`);
    await delay(200);
    assert.equal(await evaluate("document.querySelector('#preview-error').hidden", preview), false, "Expression failures shown");
    assert.equal(await evaluate("previewMessages.some(message=>message.type==='idyll.render_error')"), true, "Parent receives runtime failures");
    await evaluate("document.querySelector('#smoke-frame').remove(); document.querySelector('#sourceEditor').value='print(\"Hello, coding platform!\")'; document.querySelector('#sourceEditor').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'})); document.querySelector('#submitButton').click();");
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate("document.querySelector('#fileName').textContent==='article.idyll' && !document.querySelector('#runButton').disabled")) break;
      await delay(100);
    }
    assert.equal(await evaluate("document.querySelector('#fileName').textContent"), "article.idyll", "Practice enters formal Idyll editor");
    const source = '[var name:"quantity" value:2 /]\n[Range value:quantity min:0 max:10 /]\n[Display value:`quantity * 3` /]';
    await evaluate(`document.querySelector('#sourceEditor').value=${JSON.stringify(source)}; document.querySelector('#sourceEditor').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'})); document.querySelector('#runButton').click();`);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate("!!document.querySelector('#visualizationOutput iframe') && !document.querySelector('#runButton').disabled")) break;
      await delay(100);
    }
    assert.equal(await evaluate("document.querySelector('#visualizationOutput iframe')?.getAttribute('sandbox')"), "allow-scripts", "Editor creates isolated interactive preview: " + await evaluate("document.querySelector('#consoleOutput').textContent + ' / ' + document.querySelector('#studyState').textContent"));
    let editorPreview;
    for (let attempt = 0; attempt < 30 && !editorPreview; attempt++) {
      for (const context of contexts.filter(context => context.auxData?.isDefault).reverse()) {
        try {
          if (await evaluate("location.pathname === '/idyll-preview.html' && !!document.querySelector('input[type=range]')", context)) { editorPreview = context; break; }
        } catch (_) {}
      }
      if (!editorPreview) await delay(100);
    }
    assert.ok(editorPreview, "Editor Run renders actual Idyll Range");
    await send("Page.enable", {}, sessionId);
    await send("Page.navigate", { url: `${base}/?preview=1&task=penrose-playground-v1` }, sessionId);
    await delay(1000);
    assert.equal(await evaluate("document.querySelector('#fileName').textContent"), "diagram.substance", "Penrose editor loads");
    await evaluate("document.querySelector('#sourceEditor').value='Set A, B\\nSubset(A, B)\\nAutoLabel All'; document.querySelector('#sourceEditor').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'})); document.querySelector('#runButton').click();");
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate("!document.querySelector('#runButton').disabled && !document.querySelector('#resultContent').hidden")) break;
      await delay(100);
    }
    assert.equal(await evaluate("!!document.querySelector('#visualizationOutput iframe')"), true, "Penrose Run renders SVG frame");
    console.log("Idyll real-browser rendering, reactive updates, isolation and diagnostics passed.");
  } finally {
    socket?.close();
    browser.kill();
    await delay(300);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
