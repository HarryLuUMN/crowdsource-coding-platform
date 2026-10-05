const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/annotation.js', 'utf8');
const elements = new Map();
let scrolled = -1, refreshed = 0;
const annotations = { 0: ['LABEL'] };
const state = { selectedStep: 0, annotations, dataset: { steps: [0, 1, 2].map(index => ({ index, source: 'x;', elapsedMs: index })) } };
const context = vm.createContext({
  state, $: selector => {
    if (!elements.has(selector)) elements.set(selector, { classList: { toggle() {} } });
    return elements.get(selector);
  },
  elapsed: String, eventName: String,
  renderDiff() {}, renderCodeSnapshot() {}, renderReading() {}, renderAppliedCodes() {}, renderRuleEvidence() {},
  refreshMatrix() { refreshed++; },
});
elements.set('#matrixBody', { rows: [0, 1, 2].map(index => ({ scrollIntoView() { scrolled = index; } })) });
vm.runInContext(source.slice(source.indexOf('function renderDetail()'), source.indexOf('function renderRuleEvidence(')), context);
vm.runInContext(source.slice(source.indexOf('function selectStep('), source.indexOf('function setDetailTab(')), context);
context.renderDetail();
assert.equal(elements.get('#previousStep').disabled, true);
assert.equal(elements.get('#nextStep').disabled, false);
context.moveStep(1);
assert.equal(state.selectedStep, 1);
assert.equal(scrolled, 1);
assert.equal(elements.get('#stepTitle').textContent, 'Step 2 of 3');
context.moveStep(1);
assert.equal(elements.get('#nextStep').disabled, true);
context.moveStep(1);
assert.equal(state.selectedStep, 2);
context.moveStep(-1);
context.moveStep(-1);
context.moveStep(-1);
assert.equal(state.selectedStep, 0);
assert.equal(elements.get('#previousStep').disabled, true);
assert.equal(refreshed, 6);
assert.deepEqual(state.annotations, { 0: ['LABEL'] });
state.dataset = null;
context.moveStep(1);
state.dataset = { steps: [{ index: 0, source: 'x;' }] };
context.renderDetail();
assert.equal(elements.get('#previousStep').disabled, true);
assert.equal(elements.get('#nextStep').disabled, true);
console.log('Step navigation: selection, boundaries, scrolling, single-step traces and unchanged annotations passed');
