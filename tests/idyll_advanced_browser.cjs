const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const chrome = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = process.env.STUDIO_URL || "http://127.0.0.1:8171";
const root = path.join(__dirname, "..");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "idyll-advanced-browser-"));
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
    const logs = [];
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
      } else if (message.method === "Runtime.consoleAPICalled") {
        logs.push(message.params.args.map(arg=>arg.description || arg.value).join(" "));
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
    const waitFor = async (expression, message, context) => {
      const end = Date.now() + 20000;
      while (Date.now() < end) {
        try { if (await evaluate(expression, context)) return; } catch (_) {}
        await delay(75);
      }
      throw new Error(message);
    };
    await waitFor("!!document.querySelector('#sourceEditor')", "Host page must load");
    await send('Emulation.setDeviceMetricsOverride', {width:1600,height:1000,deviceScaleFactor:1,mobile:false}, sessionId);
    await evaluate("window.previewMessages=[]; window.addEventListener('message', e=>window.previewMessages.push(e.data)); const frame=document.createElement('iframe'); frame.id='advanced-frame'; frame.style='width:1000px;height:850px'; frame.sandbox='allow-scripts'; frame.src='/idyll-preview.html'; document.body.append(frame)");
    let preview;
    for (let attempt=0;attempt<100 && !preview;attempt++) {
      for(const context of contexts.filter(context=>context.auxData?.isDefault)) {
        try {if(await evaluate("location.pathname === '/idyll-preview.html'",context)) preview=context;}catch(_){}
      }
      if(!preview) await delay(75);
    }
    assert.ok(preview,'Sandboxed preview context must exist');
    const compile = require('idyll-compiler');
    const data = [
      {month:'2025-01-01',category:'Books',sales:120},
      {month:'2025-02-01',category:'Books',sales:180},
      {month:'2025-01-01',category:'Games',sales:90},
      {month:'2025-02-01',category:'Games',sales:160},
      {month:'2025-01-01',category:'Music',sales:100},
      {month:'2025-02-01',category:'Music',sales:140},
    ];
    const render = async source => {
      const ast=await compile(source,{async:true,spellcheck:false});
      await evaluate(`document.querySelector('#advanced-frame').contentWindow.postMessage({type:'idyll.render',ast:${JSON.stringify(ast)},datasets:{sales:${JSON.stringify(data)}}},'*')`);
      await delay(250);
      assert.equal(await evaluate("document.querySelector('#preview-error').hidden",preview),true,await evaluate("document.querySelector('#preview-error').textContent",preview));
    };
    const setControl = async (selector,value) => {
      await evaluate(`(()=>{const control=document.querySelector(${JSON.stringify(selector)});const prototype=control.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(control,${JSON.stringify(String(value))});control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));})()`,preview);
      await delay(100);
    };
    const declarations = '[data name:"sales" source:"sales-data.json" /]\n[var name:"category" value:"All" /]\n[var name:"threshold" value:0 /]\n[derived name:"shown" value:`sales.filter(row => (category === "All" || row.category === category) && row.sales >= threshold)` /]';
    await render(declarations + '\n[Select value:category options:`["All","Books","Games","Music"]` /]\n[Range value:threshold min:0 max:500 step:10 /]\n[Table data:shown /]\n[Chart data:shown type:"point" x:"month" y:"sales" color:"category" /]\nCount: [Display value:`shown.length` /]\n[derived name:"total" value:`shown.reduce((total,row)=>total+row.sales,0)` /]\n[derived name:"projection" value:`shown.map(row=>({month:row.month,category,sales:row.sales}))` /]\nTotal: [Display value:total /]\nProjected category: [Display value:`projection.length ? projection[0].category : "none"` /]');
    await waitFor("document.querySelectorAll('tbody tr').length===6",'Initial table must contain canonical dataset',preview);
    assert.equal(await evaluate("JSON.parse(document.querySelector('[data-chart-data]').dataset.chartData).length",preview),6);
    await setControl('select','Books');
    await setControl('input[type=range]',150);
    assert.equal(await evaluate("document.querySelectorAll('tbody tr').length",preview),1, logs.join("\n") + await evaluate("JSON.stringify({category:document.querySelector('select').value,threshold:document.querySelector('input[type=range]').value,chart:document.querySelector('[data-chart-data]').dataset.chartData,error:document.querySelector('#preview-error').textContent})",preview));
    assert.equal(await evaluate("JSON.parse(document.querySelector('[data-chart-data]').dataset.chartData)[0].sales",preview),180);
    assert.match(await evaluate("document.querySelector('#article').textContent",preview), /Total: 180/);
    assert.match(await evaluate("document.querySelector('#article').textContent",preview), /Projected category: Books/);
    await setControl('input[type=range]',500);
    assert.equal(await evaluate("document.querySelectorAll('tbody tr').length",preview),0);
    assert.equal(await evaluate("JSON.parse(document.querySelector('[data-chart-data]').dataset.chartData).length",preview),0);
    await setControl('input[type=range]',0);
    assert.equal(await evaluate("document.querySelectorAll('tbody tr').length",preview),2);
    const story = '[data name:"sales" source:"sales-data.json" /]\n[var name:"category" value:"Books" /]\n[var name:"threshold" value:150 /]\n[var name:"stage" value:0 /]\n[derived name:"selected" value:`sales.filter(row=>row.category===category)` /]\n[derived name:"mean" value:`sales.filter(row=>row.category==="Books").map(row=>({month:row.month,sales:sales.filter(point=>point.month===row.month).reduce((sum,point)=>sum+point.sales,0)/3}))` /]\n[Scroller step:stage]\n[Step index:0]# Whole picture\nSee all the sales categories.[/Step]\n[Step index:1]# Focus\nSelect one category.[/Step]\n[Step index:2]# Compare\nCompare with the monthly average.[/Step]\n[Step index:3]# Threshold\nHighlight large sales values.[/Step]\n[Pinned]\n[Select value:category options:`["Books","Games","Music"]` /]\n[Range value:threshold min:0 max:500 step:10 /]\nStage: [Display value:stage /]\n[Chart data:`stage < 2 ? sales : selected` type:"line" x:"month" y:"sales" color:"category" focus:`stage === 1 ? category : ""` reference:`stage === 2 ? mean : []` highlight:`stage === 3 ? selected.filter(row=>row.sales>threshold) : []` /]\n[/Pinned]\n[/Scroller]';
    await render(story);
    await waitFor("document.querySelectorAll('[data-story-step]').length===4",'Four story steps must render',preview);
    const scrollToStep = async index => {
      await evaluate(`(()=>{const step=document.querySelector('[data-story-step="${index}"]');window.scrollTo(0,window.scrollY+step.getBoundingClientRect().top-window.innerHeight*0.3);})()`,preview);
      await waitFor(`document.querySelector('[data-active-step]').dataset.activeStep==='${index}'`,'Scroll must update the bound stage',preview);
    };
    await scrollToStep(0);
    assert.equal(await evaluate("JSON.parse(document.querySelector('[data-chart-data]').dataset.chartData).length",preview),6);
    await scrollToStep(1);
    assert.equal(await evaluate("document.querySelector('[data-chart-focus]').dataset.chartFocus",preview),'Books');
    await setControl('select','Games');
    assert.equal(await evaluate("document.querySelector('[data-chart-focus]').dataset.chartFocus",preview),'Games');
    await setControl('input[type=range]',100);
    await scrollToStep(2);
    assert.equal(await evaluate("JSON.parse(document.querySelector('[data-chart-reference]').dataset.chartReference).length",preview),2);
    assert.equal(await evaluate("document.querySelectorAll('.idyll-chart-reference').length",preview),1);
    const pinBefore=await evaluate("document.querySelector('.idyll-pinned').getBoundingClientRect().top",preview);
    await evaluate("window.scrollBy(0,100)",preview);
    await delay(100);
    const pinAfter=await evaluate("document.querySelector('.idyll-pinned').getBoundingClientRect().top",preview);
    assert.ok(Math.abs(pinBefore-pinAfter)<2,'Pinned region must stay visible while the article scrolls');
    await scrollToStep(3);
    assert.equal(await evaluate("document.querySelectorAll('.idyll-chart-highlight').length",preview),1);
    assert.equal(await evaluate("JSON.parse(document.querySelector('[data-chart-highlight]').dataset.chartHighlight)[0].sales",preview),160);
    await scrollToStep(1);
    assert.equal(await evaluate("document.querySelector('select').value",preview),'Games');
    assert.equal(await evaluate("document.querySelector('input[type=range]').value",preview),'100');
    assert.equal(await evaluate("document.querySelector('[data-chart-focus]').dataset.chartFocus",preview),'Games');
    assert.equal(await evaluate("document.querySelector('.idyll-chart-reference') === null",preview),true);
    assert.equal(await evaluate("document.querySelector('#preview-error').hidden",preview),true);
    assert.equal(await evaluate("fetch('/api/health').then(()=>false).catch(()=>true)",preview),true,'Preview must retain network isolation');
    console.log('Advanced Idyll browser: shared data, linked table/chart, empty results, SVG overlays, forward/reverse scroll, sticky geometry, and persistent controls passed.');
  } finally {
    socket?.close();
    browser.kill();
    await delay(300);
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
