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
    assert.equal(await evaluate("document.querySelector('#howItWorksButton').textContent"), 'Launch User Onboarding');
    assert.equal(await evaluate("document.querySelector('#documentationFrame').getAttribute('src')"), '/python-guide.html');
    await waitFor("document.querySelector('#documentationFrame').contentDocument?.querySelector('h1')?.textContent === 'Python basics'", "Python practice documentation must load inside the frame");
    assert.equal(await evaluate("document.querySelector('#documentationFrame').contentWindow.scrollY"), 0);
    assert.equal(await evaluate("document.querySelector('.task-guide').scrollTop"), 0);
    assert.equal(await evaluate("document.querySelector('#taskDescription').getBoundingClientRect().top >= document.querySelector('.task-guide').getBoundingClientRect().top"), true);
    assert.equal(await evaluate("!!document.querySelector('.panel-footer')"), false);
    assert.equal(await evaluate("document.querySelector('#saveState').getClientRects().length"), 0);
    assert.equal(await evaluate("activeTab"), 'console');
    assert.match(await evaluate("document.querySelector('#taskDescription').textContent"), /First.*Console.*Then.*Test Results/);
    for (const output of ['Hello, world!', 'Hello, coding platform!']) {
      await evaluate(`document.querySelector('#sourceEditor').value = ${JSON.stringify(`print(${JSON.stringify(output)})`)}; document.querySelector('#runButton').click()`);
      await waitFor("!document.querySelector('#runButton').disabled", "Practice run must finish");
      assert.equal(await evaluate("activeTab"), 'console');
      assert.equal(await evaluate("document.querySelector('#consoleOutput').textContent"), output);
      await evaluate("document.querySelector('[data-tab=tests]').click()");
      assert.equal(await evaluate("activeTab"), 'tests');
    }
    await screenshot('practice-layout');
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
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.introjs-helperLayer')).borderTopWidth"), '3px');
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
    for (let step=2; step<7; step++) {
      await next();
      assert.equal(await evaluate("getComputedStyle(document.querySelector('.introjs-helperLayer')).borderTopWidth"), '3px', `Step ${step+1} has a visible outline`);
      if (step === 4) {
        assert.equal(await evaluate("getComputedStyle(document.querySelector('#runButton')).opacity"), '1');
        assert.equal(await evaluate("document.querySelector('#runButton').classList.contains('studio-onboarding-action')"), true);
        assert.equal(await evaluate("document.querySelector('#runButton').disabled"), true);
        await screenshot('step5');
      }
    }
    assert.match(await evaluate("document.querySelector('.introjs-tooltip').textContent"), /Submit when you are ready/);
    assert.equal(await evaluate("document.querySelector('.introjs-nextbutton').textContent.trim()"), 'Start Level 1');
    assert.equal(await evaluate("getComputedStyle(document.querySelector('#submitButton')).opacity"), '1');
    assert.equal(await evaluate("document.querySelector('#submitButton').classList.contains('studio-onboarding-action')"), true);
    await screenshot('step7');
    assert.equal(mutations().length, 0, "The entire guide is excluded from formal trace recording");
    assert.equal(await evaluate("document.querySelector('#sourceEditor').value"), '');
    await next();
    await waitFor("formalSessionReady && !onboardingActive && !document.querySelector('#runButton').disabled && !document.querySelector('.introjs-tooltip')", "Completion must start formal task");
    await waitFor("!!telemetrySessionId", "Formal trace starts only after tour completion");
    assert.equal(await evaluate("document.body.classList.contains('studio-onboarding-action-step')"), false);
    assert.equal(await evaluate("document.body.classList.contains('studio-onboarding-active')"), false);
    assert.equal(await evaluate("document.querySelectorAll('.studio-onboarding-action').length"), 0);
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
    for (const dsl of ['knitscript', 'vega-lite', 'idyll', 'penrose']) {
      await navigate(`${base}/${dsl}?preview=1&PROLIFIC_PID=console-${dsl}-${Date.now()}`);
      await waitFor("!document.querySelector('#runButton').disabled", "Practice must initialize");
      assert.equal(await evaluate("activeTab"), 'console', `${dsl} practice must default to Console`);
      await enterPractice();
      await waitFor("!!document.querySelector('.introjs-tooltip')", `${dsl} formal onboarding must open`);
      assert.equal(await evaluate("activeTab"), 'console', `${dsl} transition must default to Console`);
      if (dsl === 'idyll') {
        await waitFor("document.querySelector('#documentationFrame').contentDocument?.querySelector('h1')?.textContent === 'Idyll documentation'", "Formal Idyll tasks must embed the dedicated documentation");
        assert.equal(await evaluate("document.querySelector('#documentationFrame').getAttribute('src')"), '/idyll-guide.html');
        await evaluate("document.querySelector('#documentationSearch').value = 'TextInput'; searchDocumentation()");
        assert.equal(await evaluate("documentationMatches.length > 0"), true, 'Idyll documentation must be searchable');
      }
      await completeTour();
      await waitFor("formalSessionReady && !document.querySelector('#runButton').disabled", `${dsl} formal task must become ready`);
      for (const width of [2200, 1100, 700]) {
        await send('Emulation.setDeviceMetricsOverride', {width,height:1000,deviceScaleFactor:1,mobile:false}, sessionId);
        assert.equal(await evaluate(`(() => {
          const guide = document.querySelector('.task-guide');
          const right = guide.getBoundingClientRect().right - parseFloat(getComputedStyle(guide).paddingRight);
          return ['.task-copy', '.task-title-row', '#taskDescription', '.independent-work-warning'].every(selector => Math.abs(document.querySelector(selector).getBoundingClientRect().right - right) < 2);
        })()`), true, `${dsl} task content must fill the panel at ${width}px`);
        if (width === 2200) await screenshot(`task-width-${dsl}`);
      }
      await send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
      const tutorialPaths = {knitscript:'/tutorial.html', 'vega-lite':'/vega-guide.html', idyll:'/idyll-tutorial.html', penrose:'/penrose-tutorial.html'};
      const tutorialTitles = {knitscript:'KnitScript tutorial', 'vega-lite':'Vega-Lite tutorial', idyll:'Idyll tutorial', penrose:'Penrose tutorial'};
      await evaluate("document.querySelector('[data-documentation-view=tutorial]').click()");
      await waitFor(`document.querySelector('#tutorialFrame').contentDocument?.title === ${JSON.stringify(tutorialTitles[dsl])}`, `${dsl} tutorial must load in the frame`);
      assert.equal(await evaluate("document.querySelector('#tutorialFrame').getAttribute('src')"), tutorialPaths[dsl]);
      assert.equal(await evaluate("document.querySelector('#tutorialFrame').hidden"), false);
      assert.equal(await evaluate("document.querySelector('#documentationFrame').hidden"), true);
      assert.equal(await evaluate("documentationReadingSnapshot(document.querySelector('#tutorialFrame')).guide_kind"), 'tutorial');
      assert.equal(await evaluate("document.querySelector('#tutorialFrame').contentDocument.querySelectorAll('h2').length >= 5"), true);
      await screenshot(`tutorial-${dsl}`);
      await evaluate("document.querySelector('[data-documentation-view=documentation]').click()");
      assert.equal(await evaluate("document.querySelector('#documentationFrame').hidden"), false);
      await evaluate("document.querySelector('#runButton').click()");
      await waitFor("!document.querySelector('#runButton').disabled && !document.querySelector('#resultContent').hidden", `${dsl} actual run must finish`, 60000);
      assert.equal(await evaluate("activeTab"), 'console', `${dsl} actual run must open Console`);
      await screenshot(`console-${dsl}`);
      assert.equal(await evaluate("activeTab"), 'console', `${dsl} must default to Console`);
      for (const ok of [true, false]) {
        await evaluate(`selectTab('tests'); showResult({ok:${ok}, stdout:'Console regression', knitout:'', check:{passed:false, tests:[]}})`);
        assert.equal(await evaluate("activeTab"), 'console', `${dsl} result must open Console`);
        assert.equal(await evaluate("document.querySelector('#consoleOutput').hidden"), false);
        await evaluate("document.querySelector('[data-tab=tests]').click()");
        assert.equal(await evaluate("activeTab"), 'tests', 'Manual tab selection must remain available');
      }
    }
    console.log('Intro.js browser: seven-step onboarding, keyboard navigation, isolated traces/timing, replay, reload, cancellation and missing-library recovery passed.');
  } finally {
    socket?.close();
    browser.kill();
    await delay(300);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
