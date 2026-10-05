const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/annotation.js', 'utf8');
const rawSteps = [0, 1, 2].map(index => ({ index, source: 'x;', event: 'guide.scroll' }));
const semanticDataset = { granularity: 'syntactic-unit-v2', trace: { id: 'test' }, rawSteps, rawAnnotations: {}, steps: [
  { index: 0, rawStepIndices: [0, 1] }, { index: 1, rawStepIndices: [2] },
] };
const semanticAnnotations = { 0: ['LABEL'], 1: ['OTHER'] };
const state = { dataset: semanticDataset, annotations: semanticAnnotations, selectedStep: 0, decisions: {} };
const elements = new Map();
const saved = [];
const context = vm.createContext({ state, traceView: 'semantic', semanticDataset, semanticAnnotations, semanticRules: { detections: [] },
  annotationReadOnly: false, STORAGE_PREFIX: 'trace-annotations:', structuredClone,
  localStorage: { setItem(key, value) { saved.push(JSON.parse(value)); } },
  $: selector => {
    if (!elements.has(selector)) elements.set(selector, { rows: rawSteps.map(() => ({ scrollIntoView() {} })) });
    return elements.get(selector);
  }, detectAnnotationRules: () => ({ detections: [] }), renderTrace() {}, renderMatrix() {}, renderDetail() {}, updateProgress() {},
});
vm.runInContext(source.slice(source.indexOf('function projectRawAnnotations()'), source.indexOf('let matrixZoom')), context);
vm.runInContext(source.slice(source.indexOf('function storageKey()'), source.indexOf('function loadAnnotations()')), context);
vm.runInContext(source.slice(source.indexOf('function saveAnnotations()'), source.indexOf('function selectedCodes(')), context);
context.switchTraceView('raw');
assert.equal(state.dataset.steps.length, 3);
assert.equal(state.selectedStep, 0);
assert.equal(state.annotations[1][0], 'LABEL');
state.selectedStep = 1;
state.annotations[1] = ['EDITED'];
context.saveAnnotations();
assert.equal(state.annotations[0][0], 'EDITED');
assert.equal(saved.at(-1).granularity, 'syntactic-unit-v2');
context.switchTraceView('semantic');
assert.equal(state.selectedStep, 0);
assert.equal(state.annotations[0][0], 'EDITED');
state.selectedStep = 1;
context.switchTraceView('raw');
assert.equal(state.selectedStep, 2);
state.annotations[2] = [];
context.switchTraceView('semantic');
assert.equal(state.selectedStep, 1);
assert.equal(state.annotations[1].length, 0);
context.annotationReadOnly = true;
const before = saved.length;
context.switchTraceView('raw');
assert.equal(saved.length, before);
assert.equal(state.dataset.steps.length, 3);
context.annotationReadOnly = false;
semanticDataset.steps[1].rawStepIndices = [];
state.annotations[2] = ['RAW_ONLY'];
context.saveAnnotations();
assert.equal(saved.at(-1).rawEventAnnotations[2][0], 'RAW_ONLY');
context.switchTraceView('semantic');
context.switchTraceView('raw');
assert.equal(state.annotations[2][0], 'RAW_ONLY');
console.log('Trace views: raw coverage, position mapping, shared labels, clear and read-only navigation passed');
