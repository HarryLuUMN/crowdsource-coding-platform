const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = process.env.STUDIO_URL || "http://127.0.0.1:8173";
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onboarding-browser-"));
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
    const participant = `idyll-task-flow-${Date.now()}`;
    const url = `${base}/idyll?preview=1&PROLIFIC_PID=${participant}&STUDY_ID=intro-study&SESSION_ID=intro-session`;
    const requests = [];
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.method === "Network.requestWillBeSent") requests.push(message.params.request);
    });
    await send("Network.enable", {}, sessionId);
    const mutations = () => requests.filter(request => /\/api\/(sessions(?:\/end)?|events|run|submit)$/.test(new URL(request.url).pathname));
    const navigate = async url => {
      await send("Page.navigate", {url}, sessionId);
      await waitFor("document.readyState==='complete' && !!document.querySelector('#sourceEditor') && !!window.StudioOnboarding", "Page did not load");
    };
    const enterPractice = async () => {
      await waitFor("!document.querySelector('#submitButton').disabled", "Practice controls unavailable");
      await evaluate("document.querySelector('#sourceEditor').value='print(\"Hello, coding platform!\")'; document.querySelector('#sourceEditor').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'})); document.querySelector('#submitButton').click()");
    };
    const next = async () => {
      await evaluate("document.querySelector('.introjs-nextbutton').click()");
      await delay(200);
    };
    const screenshot = async name => {
      await delay(300);
      const shot = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:false}, sessionId);
      fs.writeFileSync(`/tmp/intro-${name}.png`, Buffer.from(shot.data,'base64'));
    };
    const enterSource = async source => {
      await evaluate(`document.querySelector('#sourceEditor').value=${JSON.stringify(source)}; document.querySelector('#sourceEditor').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}))`);
    };
    const clickSubmit = () => evaluate("document.querySelector('#submitButton').click()");
    const readyFor = async task => {
      await waitFor(`TASK_ID === ${JSON.stringify(task)} && formalSessionReady && !document.querySelector('#runButton').disabled`, `Task ${task} must become ready`, 30000);
    };
    await send('Emulation.setDeviceMetricsOverride', {width:1600,height:1100,deviceScaleFactor:1,mobile:false}, sessionId);
    await navigate(url);
    await enterPractice();
    await waitFor("!!document.querySelector('.introjs-tooltip')", "Formal onboarding must open");
    await completeTour();
    await readyFor('idyll-calculator-v1');
    const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/structured_solutions.json'), 'utf8'));
    const advanced = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/idyll_advanced_solutions.json'), 'utf8'));
    await enterSource(legacy['idyll-calculator-v1']);
    await clickSubmit();
    await readyFor('idyll-explorer-v2');
    for (const task of ['idyll-explorer-v2', 'idyll-story-v2']) {
      await readyFor(task);
      assert.equal(await evaluate("document.querySelector('#sourceEditor').value"), '', 'Replacement tasks must start with an empty editor');
      assert.equal(await evaluate("document.querySelector('#taskArticle').hidden"), false);
      assert.equal(await evaluate("document.querySelector('#taskArticleText').textContent === selectedTask.article"), true);
      await evaluate("window.copiedTaskArticle = null; navigator.clipboard.writeText = async text => { window.copiedTaskArticle = text; }; document.querySelector('#copyTaskArticle').click()");
      await waitFor("window.copiedTaskArticle === selectedTask.article", "Copy article must copy only the supplied Markdown");
      await evaluate("document.querySelector('#taskArticle').scrollIntoView({block:'start'})");
      assert.equal(await evaluate("(() => {const guide=document.querySelector('.task-guide').getBoundingClientRect(),button=document.querySelector('#copyTaskArticle').getBoundingClientRect();return button.top >= guide.top && button.bottom <= guide.bottom;})()"), true, 'Copy article must be reachable and visible in the scrollable task panel');
      await screenshot(`article-${task}`);
      await enterSource(advanced[task]);
      await evaluate("document.querySelector('[data-tab=visualization]').click(); document.querySelector('#runButton').click()");
      await waitFor("!document.querySelector('#runButton').disabled && !!document.querySelector('#visualizationOutput iframe')", `${task} Run must create the article preview`, 30000);
      assert.equal(await evaluate("activeTab"), 'visualization', 'Run must retain Compiled Article');
      assert.equal(await evaluate("[...document.querySelectorAll('#testOutput .test-case')].every(node => node.classList.contains('passed')) && document.querySelectorAll('#testOutput .test-case').length > 0"), true, `${task} reference solution must pass Checks`);
      await screenshot(`compiled-${task}`);
      await clickSubmit();
      if (task === 'idyll-explorer-v2') await readyFor('idyll-story-v2');
      else await waitFor("taskProgress?.completed && document.querySelectorAll('#taskProgress .task-step.passed').length === 3", "Final passing submission must complete the three-level study", 30000);
    }
    console.log('Idyll task flow: Python practice, Level 1, copyable articles, advanced Run/Checks, sequential submission, and completion passed.');
  } finally {
    socket?.close();
    browser.kill();
    await delay(300);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
