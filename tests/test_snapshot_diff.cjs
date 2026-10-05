const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function element() {
  return { children: [], classList: { toggle() {} }, append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; this.textContent = ''; } };
}
const code = element();
const state = { dataset: { steps: [{ source: 'x = 1;\nkeep;' }, { index: 1, source: 'x = 2;\nkeep;', previousSource: 'wrong' }] } };
const context = vm.createContext({ state, $: () => code, document: { createElement: element } });
const source = fs.readFileSync('static/annotation.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('function lineDiff('), source.indexOf('function renderReading(')), context);
context.renderCodeSnapshot(state.dataset.steps[1]);
assert(code.children.some(row => row.className === 'snapshot-line remove' && row.children[1].textContent === '- x = 1;'));
assert(code.children.some(row => row.className === 'snapshot-line add' && row.children[1].textContent === '+ x = 2;'));
assert(code.children.some(row => row.className === 'snapshot-line same' && row.children[1].textContent === '  keep;'));
state.dataset.steps[1].source = state.dataset.steps[0].source;
context.renderCodeSnapshot(state.dataset.steps[1]);
assert.equal(code.children.length, 2);
assert(code.children.every(row => row.className === 'snapshot-line same'));
state.dataset.steps[0].source = '';
state.dataset.steps[1].source = '<script>example</script>';
context.renderCodeSnapshot(state.dataset.steps[1]);
assert(code.children.some(row => row.children[1].textContent === '+ <script>example</script>'));
console.log('Snapshot diff: previous displayed step, additions, deletions, unchanged source and literal code passed');
