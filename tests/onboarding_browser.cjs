const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = process.env.STUDIO_URL || "http://127.0.0.1:8160";
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
    const participant = `onboarding-smoke-${Date.now()}`;
    const url = `${base}/penrose?preview=1&PROLIFIC_PID=${participant}&STUDY_ID=intro-study&SESSION_ID=intro-session`;
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
      const shot = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:true}, sessionId);
      fs.writeFileSync(`/tmp/intro-${name}.png`, Buffer.from(shot.data,'base64'));
    };
    await navigate(url);
    await waitFor("!document.querySelector('#submitButton').disabled", "Practice controls should load");
    assert.equal(await evaluate("document.querySelector('#howItWorksButton').hidden"), false);
    assert.equal(await evaluate("document.querySelector('#howItWorksButton').textContent"), 'Start UI Tutorial');
    await evaluate("document.querySelector('#howItWorksButton').click()");
    await waitFor("onboardingActive && !!document.querySelector('.introjs-tooltip')", "Visible tutorial button must work during practice");
    assert.equal(await evaluate("currentStudyPhase"), 'practice');
    assert.equal(await evaluate("formalSessionReady"), false);
    await screenshot('manual-practice');
    await evaluate("document.querySelector('.introjs-skipbutton').click()");
    await waitFor("!onboardingActive && !document.querySelector('#runButton').disabled", "Closing practice tutorial must restore practice");
    await delay(2200);
    assert.equal(mutations().length, 0, "Practice creates no formal traces");
    await enterPractice();
    await waitFor("!!document.querySelector('.introjs-tooltip')", "First formal task should automatically show tour");
    assert.equal(await evaluate("formalSessionReady"), false);
    assert.equal(await evaluate("document.querySelector('#runButton').disabled && document.querySelector('#sourceEditor').disabled"), true);
    assert.match(await evaluate("document.querySelector('.introjs-tooltip').textContent"), /Complete three tasks/);
    assert.equal(await evaluate("document.querySelector('#submitButton span').textContent.trim()"),'Submit','Guide must not retain practice submission loading text');
    await screenshot('step1');
    await next();
    assert.match(await evaluate("document.querySelector('.introjs-tooltip').textContent"), /Read the task requirements/);
    await evaluate("document.querySelector('.introjs-prevbutton').click()");
    await delay(200);
    assert.match(await evaluate("document.querySelector('.introjs-tooltip').textContent"), /Complete three tasks/);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39},sessionId);
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39},sessionId);
    await delay(200);
    assert.match(await evaluate("document.querySelector('.introjs-tooltip').textContent"), /Read the task requirements/);
    for (let step=2; step<7; step++) await next();
    assert.match(await evaluate("document.querySelector('.introjs-tooltip').textContent"), /Submit when you are ready/);
    assert.equal(await evaluate("document.querySelector('.introjs-nextbutton').textContent.trim()"), 'Start Level 1');
    await screenshot('step7');
    assert.equal(mutations().length, 0, "The entire guide is excluded from formal trace recording");
    assert.equal(await evaluate("document.querySelector('#sourceEditor').value"), '');
    await next();
    await waitFor("formalSessionReady && !onboardingActive && !document.querySelector('#runButton').disabled && !document.querySelector('.introjs-tooltip')", "Completion must start formal task");
    await waitFor("!!telemetrySessionId", "Formal trace starts only after tour completion");
    assert.equal(requests.filter(request => new URL(request.url).pathname==='/api/sessions').length,1);
    await send('Page.reload',{},sessionId);
    await waitFor("document.readyState==='complete' && formalSessionReady && !document.querySelector('#runButton').disabled", "Formal progress should resume");
    assert.equal(await evaluate("!!document.querySelector('.introjs-tooltip')"),false,"Tour does not repeat after reload");
    const draft='Set A\nAutoLabel All';
    await evaluate(`document.querySelector('#sourceEditor').value=${JSON.stringify(draft)}; document.querySelector('#sourceEditor').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));`);
    await evaluate("flushEvents()");
    const countBeforeReplay=mutations().length;
    const elapsedBefore=await evaluate("performance.now()-telemetryStartedAt");
    await evaluate("document.querySelector('#howItWorksButton').click()");
    await waitFor("onboardingActive && !!document.querySelector('.introjs-tooltip')", "Replay must open");
    await delay(2000);
    assert.equal(await evaluate("document.querySelector('#sourceEditor').value"),draft);
    await evaluate("document.querySelector('.introjs-skipbutton').click()");
    await waitFor("!onboardingActive && !document.querySelector('#runButton').disabled", "Closing replay must restore controls");
    const elapsedAfter=await evaluate("performance.now()-telemetryStartedAt");
    assert.ok(elapsedAfter-elapsedBefore<1500,`Replay should pause formal elapsed time: ${elapsedAfter-elapsedBefore}`);
    assert.equal(mutations().length,countBeforeReplay,"Replay creates no formal events or executions");
    assert.equal(await evaluate("document.querySelector('#sourceEditor').value"),draft);
    await navigate(`${url}&onboarding=1`);
    await waitFor("onboardingActive && !!document.querySelector('.introjs-tooltip')", "URL flag must force an already-completed guide");
    assert.equal(await evaluate("formalSessionReady"), false, "Forced guide still gates formal recording");
    assert.equal(await evaluate("document.querySelector('#sourceEditor').value"), draft, "Force replay preserves the current draft");
    await completeTour();
    await waitFor("formalSessionReady && !onboardingActive", "Forced guide must finish normally");
    await navigate(url);
    await waitFor("formalSessionReady && !document.querySelector('#runButton').disabled", "Removing force flag must restore normal entry");
    assert.equal(await evaluate("!!document.querySelector('.introjs-tooltip')"), false);
    const second=`missing-smoke-${Date.now()}`;
    await navigate(`${base}/knitscript?preview=1&PROLIFIC_PID=${second}&STUDY_ID=intro-study&SESSION_ID=intro-missing-session`);
    await evaluate("window.savedOnboarding=window.StudioOnboarding; window.StudioOnboarding=undefined;");
    const beforeFailure=mutations().length;
    await enterPractice();
    await waitFor("!document.querySelector('#onboardingNotice').hidden", "Unavailable tour must show a retry notice");
    assert.equal(await evaluate("formalSessionReady"),false);
    assert.equal(await evaluate("document.querySelector('#runButton').disabled"),true);
    await delay(2100);
    assert.equal(mutations().length,beforeFailure,"Missing library must not start a formal trace");
    await evaluate("window.StudioOnboarding=window.savedOnboarding; document.querySelector('#onboardingRetryButton').click()");
    await waitFor("!!document.querySelector('.introjs-tooltip')", "Retry must reopen guide");
    await evaluate("document.querySelector('.introjs-skipbutton').click()");
    await waitFor("!onboardingActive && !document.querySelector('#onboardingNotice').hidden", "Cancelled required guide must remain gated");
    assert.equal(await evaluate("formalSessionReady"),false);
    await evaluate("document.querySelector('#onboardingRetryButton').click()");
    await waitFor("!!document.querySelector('.introjs-tooltip')", "Required guide can be retried after closing");
    for(let step=0;step<7;step++) await next();
    await waitFor("formalSessionReady && !onboardingActive && !document.querySelector('#runButton').disabled", "Retried guide must unlock task");
    console.log('Intro.js browser: seven-step onboarding, keyboard navigation, isolated traces/timing, replay, reload, cancellation and missing-library recovery passed.');
  } finally {
    socket?.close();
    browser.kill();
    await delay(300);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
