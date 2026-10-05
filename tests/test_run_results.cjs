const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function element() { return { children: [], append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; } }; }
const panel = element(), content = element();
const context = vm.createContext({ $: selector => selector === '#runResults' ? panel : content, document: { createElement: element } });
const source = fs.readFileSync('static/annotation.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('function runResultsForStep('), source.indexOf('function renderDetail(')), context);
context.renderRunResults({ event: 'editor.edit' });
assert.equal(panel.hidden, true);
context.renderRunResults({ event: 'run.requested' });
assert.equal(panel.hidden, true);
context.renderRunResults({ event: 'run.failed', payload: { error_type: 'SyntaxError', duration_ms: 42, check: { passed_count: 0, total_count: 1, tests: [{ label: 'Compiles', passed: false, message: 'Missing token' }] } } });
assert.equal(panel.hidden, false);
assert.equal(content.children[0].children[0].textContent, 'Execution failed · 42 ms');
assert(content.children[0].children.some(item => item.textContent === 'Error: SyntaxError'));
assert(content.children[0].children.some(item => item.textContent === 'FAIL · Compiles — Missing token'));
context.renderRunResults({ event: 'compiler.execution', note: 'Passes all checks.' });
assert.equal(content.children[0].children[0].textContent, 'Passes all checks.');
assert(content.children[0].children[1].textContent.includes('detailed output was not recorded'));
context.renderRunResults({ rawSteps: [{ event: 'run.completed', payload: { check: { passed_count: 4, total_count: 5 } } }] });
assert(content.children[0].children.some(item => item.textContent === 'Task checks: 4/5 passed'));
console.log('Run results: no-result hiding, failures, checks, raw provenance and legacy limitations passed');
context.renderRunResults({ event: 'run.requested', rawSteps: [{ event: 'run.requested' }], runResult: { event: 'run.failed', payload: { error_type: 'Parsing_Error', error_message: 'Expected block opening brace', check: { passed_count: 0, total_count: 5 } } } });
assert.equal(panel.hidden, false);
assert(content.children[0].children.some(item => item.textContent === 'Expected block opening brace'));
assert(content.children[0].children.some(item => item.textContent === 'Task checks: 0/5 passed'));
const dataset = JSON.parse(fs.readFileSync('annotation_data/s4-units.json', 'utf8'));
const runs = dataset.steps.filter(step => /^(run\.requested|compiler\.execution)$/.test(step.event));
assert.equal(runs.length, 24);
assert.equal(new Set(runs.map(step => step.runResult.payload.execution_id)).size, 24);
for (const step of runs) {
  const hash = require('node:crypto').createHash('sha256').update(step.source).digest('hex');
  assert.equal(step.runResult.payload.code_state_id, `sha256:${hash}`);
  context.renderRunResults(step);
  assert.equal(panel.hidden, false);
}
