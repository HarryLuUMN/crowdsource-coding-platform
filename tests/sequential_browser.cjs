const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = process.env.STUDIO_URL || "http://127.0.0.1:8140";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sequential-browser-"));
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
    const participant = `sequence-smoke-${Date.now()}`;
    const parameters = `?preview=1&PROLIFIC_PID=${participant}&STUDY_ID=sequence-study&SESSION_ID=sequence-session`;
    const navigate = async url => {
      await send("Page.navigate", { url }, sessionId);
      await waitFor("document.readyState === 'complete' && !!window.DSL_TASK_CATALOG && !!document.querySelector('#sourceEditor')", `Page failed to load: ${url}`);
    };
    const enterSource = source => evaluate(`document.querySelector('#sourceEditor').value=${JSON.stringify(source)}; document.querySelector('#sourceEditor').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));`);
    const tasks = ['penrose-nested-v1', 'penrose-overlap-v1', 'penrose-points-v1'];
    const sources = [
      'Set A, B, C\nSubset(A, B)\nSubset(B, C)\nAutoLabel All',
      'Set A, B, C\nIntersecting(A, B)\nDisjoint(A, C)\nDisjoint(B, C)\nAutoLabel All',
      'Set A, B\nPoint p, q\nDisjoint(A, B)\nIn(p, A)\nNotIn(p, B)\nIn(q, B)\nNotIn(q, A)\nAutoLabel All'
    ];
    await navigate(`${base}/penrose${parameters}&task=penrose-points-v1`);
    await waitFor("new URLSearchParams(location.search).get('task')==='penrose-nested-v1' && !document.querySelector('#runButton').disabled", 'Task3 jump must return to Task1');
    await enterSource('print("Hello, coding platform!")');
    await evaluate("document.querySelector('#submitButton').click()");
    await waitFor("document.querySelector('#fileName').textContent==='diagram.substance' && !document.querySelector('#runButton').disabled", 'Onboarding must enter Task1');
    assert.deepEqual(await evaluate("Array.from(document.querySelector('#taskSelect').options).map(option=>option.disabled)"), [false, true, true]);
    assert.equal(await evaluate("document.querySelector('#submitButton').hidden"), false);
    assert.equal(await evaluate("document.querySelector('#taskDropdown').hidden"), true);
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#taskProgress li')).map(step=>step.className)"), ['task-step current','task-step locked','task-step locked']);
    await enterSource('Set A\nAutoLabel All');
    await evaluate("document.querySelector('#submitButton').click()");
    await waitFor("!document.querySelector('#submitButton').disabled && document.querySelector('#testOutput').textContent.includes('Required typed objects')", 'Failed submission did not return feedback', 25000);
    assert.equal(await evaluate("document.querySelector('#taskSelect').value"), tasks[0]);
    assert.equal(await evaluate("new URLSearchParams(location.search).get('PROLIFIC_PID')"), participant);
    for (let index = 0; index < tasks.length; index++) {
      await enterSource(sources[index]);
      await evaluate("document.querySelector('#submitButton').click()");
      if (index < 2) {
        await waitFor(`document.querySelector('#taskSelect').value===${JSON.stringify(tasks[index + 1])} && !document.querySelector('#runButton').disabled`, `Accepted task${index + 1} did not advance`, 30000);
        assert.equal(await evaluate("document.querySelector('#sourceEditor').value"), '', 'Next task starts blank');
        assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#taskProgress li')).map(step=>step.className)"), tasks.map((_, step) => `task-step ${step <= index ? 'passed' : step === index + 1 ? 'current' : 'locked'}`));
        assert.equal(await evaluate("new URLSearchParams(location.search).get('PROLIFIC_PID')"), participant);
        assert.equal(await evaluate("new URLSearchParams(location.search).get('STUDY_ID')"), 'sequence-study');
        assert.equal(await evaluate("new URLSearchParams(location.search).get('SESSION_ID')"), 'sequence-session');
        await send('Page.reload', {}, sessionId);
        await waitFor(`document.querySelector('#taskSelect')?.value===${JSON.stringify(tasks[index + 1])} && !document.querySelector('#runButton').disabled`, 'Reload must retain current task');
      } else {
        await waitFor("document.querySelector('#completionDialog').open && document.querySelector('#completionTitle').textContent==='All three tasks completed'", 'Final task did not complete set', 30000);
        assert.equal(await evaluate("document.querySelector('#runButton').disabled"), true);
      }
    }
    await send('Page.reload', {}, sessionId);
    await waitFor("document.querySelector('#completionDialog')?.open && document.querySelector('#completionTitle').textContent==='All three tasks completed'", 'Completed set must remain completed after reload');
    assert.equal(await evaluate("document.querySelector('#submitButton').disabled"), true);
    assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('#taskProgress li')).map(step=>step.className)"), tasks.map(()=> 'task-step passed'));
    console.log('Sequential browser: failed check stays, URL skipping blocked, all3 Submit/save/advance, identity and reload passed.');
  } finally {
    socket?.close();
    browser.kill();
    await delay(300);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
