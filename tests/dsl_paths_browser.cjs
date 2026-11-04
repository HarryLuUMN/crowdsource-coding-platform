const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = process.env.STUDIO_URL || "http://127.0.0.1:8137";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dsl-paths-browser-"));
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
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Page.enable", {}, sessionId);
    const evaluate = async expression => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression, message, timeout = 15000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        try { if (await evaluate(expression)) return; } catch (_) {}
        await delay(100);
      }
      throw new Error(message);
    };
    const completeTour = async () => {
      for (let step = 0; step < 9; step++) {
        const active = await evaluate("!!document.querySelector('.introjs-tooltip')");
        if (!active) return;
        await evaluate("document.querySelector('.introjs-nextbutton').click()");
        await delay(160);
      }
      throw new Error("The onboarding tour did not finish");
    };
    const parameters = "?preview=1&PROLIFIC_PID=path-smoke-user&STUDY_ID=path-smoke-study&SESSION_ID=path-smoke-session";
    const navigate = async url => {
      await send("Page.navigate", { url }, sessionId);
      await waitFor("document.readyState === 'complete' && !!window.DSL_TASK_CATALOG && !!document.querySelector('#sourceEditor') && (!!document.querySelector('.introjs-tooltip') || !document.querySelector('#runButton').disabled)", `Page failed to load: ${url}`);
      await completeTour();
      await waitFor("!document.querySelector('#runButton').disabled", `Guide did not release the editor: ${url}`);
    };
    const enterSource = source => evaluate(`document.querySelector('#sourceEditor').value=${JSON.stringify(source)}; document.querySelector('#sourceEditor').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));`);
    const assertTaskSet = async (dsl, firstTask) => {
      assert.equal(await evaluate("document.querySelector('#languageSelect').value"), dsl);
      assert.equal(await evaluate("document.querySelector('#languageSelect').disabled"), true, "DSL path locks language even locally");
      assert.equal(await evaluate("document.querySelector('#taskSelect').options.length"), 3);
      assert.equal(await evaluate("document.querySelector('#taskSelect').value"), firstTask);
      assert.equal(await evaluate("document.querySelector('#taskSelect').disabled"), false);
      assert.equal(await evaluate("document.querySelector('#submitButton').hidden"), false, "Catalog tasks support checked submission");
      assert.equal(await evaluate("document.querySelector('#taskSelect').options[1].disabled && document.querySelector('#taskSelect').options[2].disabled"), true, "Later tasks stay locked");
    };
    await navigate(`${base}/knitscript${parameters}`);
    await enterSource('print("Hello, coding platform!")');
    await evaluate("document.querySelector('#submitButton').click()");
    await waitFor("!!document.querySelector('.introjs-tooltip') || (document.querySelector('#fileName').textContent === 'swatch.ks' && !document.querySelector('#runButton').disabled)", "Onboarding did not enter guide");
    await completeTour();
    await waitFor("document.querySelector('#fileName').textContent === 'swatch.ks' && !document.querySelector('#runButton').disabled", "Onboarding did not enter formal task");
    await assertTaskSet("knitscript", "knitscript-plain-v1");
    for (const [dsl, firstTask] of [["vega-lite", "vega-lite-bar-v1"], ["idyll", "idyll-calculator-v1"], ["penrose", "penrose-nested-v1"]]) {
      await navigate(`${base}/${dsl}/${parameters}&task=stockinette-swatch-v1`);
      await assertTaskSet(dsl, firstTask);
      assert.equal(await evaluate("document.querySelector('#sourceEditor').value"), "", "New task begins with empty source");
    }
    await navigate(`${base}/idyll${parameters}&task=penrose-points-v1`);
    await assertTaskSet("idyll", "idyll-calculator-v1");
    const draft = '[var name:"quantity" value:2 /]\n[Display value:quantity /]';
    await enterSource(draft);
    await evaluate("document.querySelector('#taskSelect').value='idyll-converter-v1'; document.querySelector('#taskSelect').dispatchEvent(new Event('change',{bubbles:true}));");
    assert.equal(await evaluate("document.querySelector('#taskSelect').value"), "idyll-calculator-v1", "Task selector rejects skipping");
    await evaluate("flushEvents()");
    await delay(500);
    await navigate(`${base}/idyll${parameters}&task=idyll-conditional-v1`);
    await waitFor("document.querySelector('#taskSelect').value==='idyll-calculator-v1' && !document.querySelector('#runButton').disabled", "Direct URL did not restore current unlocked task");
    assert.equal(await evaluate("document.querySelector('#sourceEditor').value"), draft, "Current task draft survives skip rejection and reload");
    for (const [key, value] of [["PROLIFIC_PID", "path-smoke-user"], ["STUDY_ID", "path-smoke-study"], ["SESSION_ID", "path-smoke-session"]]) {
      assert.equal(await evaluate(`new URL(location.href).searchParams.get(${JSON.stringify(key)})`), value);
    }
    await navigate(`${base}/vega-lite${parameters}`);
    const chart = { data: { url: "/sales-data.json" }, mark: "bar", encoding: { x: { field: "category", type: "nominal" }, y: { field: "sales", aggregate: "sum", type: "quantitative" } } };
    await enterSource(JSON.stringify(chart));
    await evaluate("document.querySelector('#runButton').click()");
    await waitFor("!document.querySelector('#runButton').disabled && !!document.querySelector('#visualizationOutput iframe')", "Aggregated Vega-Lite chart did not render", 25000);
    await waitFor("!!document.querySelector('#visualizationOutput iframe').contentDocument?.querySelector('svg')", "Vega-Lite chart preview is missing SVG");
    assert.equal(await evaluate("document.querySelector('#visualizationOutput iframe').contentDocument.querySelector('#error').textContent"), "");
    await navigate(`${base}/penrose${parameters}`);
    await enterSource("Set A, B\nSubset(A, B)\nAutoLabel All");
    await evaluate("document.querySelector('#runButton').click()");
    await waitFor("!document.querySelector('#runButton').disabled && !!document.querySelector('#visualizationOutput iframe')", "Penrose path did not render diagram", 25000);
    assert.equal(await evaluate("document.querySelector('#visualizationOutput iframe').getAttribute('sandbox')"), "", "Penrose SVG remains script-free");
    console.log("DSL paths: four task sets, onboarding, language locks, sequential locks/draft restoration, URL identity, Vega aggregation and Penrose rendering passed.");
  } finally {
    socket?.close();
    browser.kill();
    await delay(300);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
