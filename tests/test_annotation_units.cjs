const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('static/annotation-units.js', 'utf8'), context);
function dataset(sources, events = []) {
  return {trace: {id: 'test'}, annotations: {1: ['LABEL']}, steps: sources.map((source, index) => ({
    index, source, previousSource: index ? sources[index - 1] : '', changed: !index || source !== sources[index - 1],
    event: events[index] || 'editor.edit', elapsedMs: index * 100, sourceSteps: [index + 1],
  }))};
}
function verify(result, finalSource) {
  assert.equal(result.steps.at(-1).source, finalSource);
  result.steps.slice(1).forEach((step, i) => assert.equal(step.previousSource, result.steps[i].source));
  assert.equal(new Set(result.steps.flatMap(s => s.rawStepIndices)).size, result.rawSteps.length);
}
const typing = dataset(['x', 'x =', 'x = 10', 'x = 10;', 'x = 10;', 'x = 11;'], ['', '', '', '', 'run.requested']);
const units = context.buildUnitDataset(typing);
assert.equal(units.steps.length, 3);
assert.equal(units.steps[0].unitType, 'assignment');
assert.equal(units.steps[2].unitType, 'small_span');
assert.equal(units.annotations[0][0], 'LABEL');
assert.equal(units.steps[0].annotationProvenance[0].rawStep, 1);
verify(units, 'x = 11;');
const pasted = context.buildUnitDataset(dataset(['with Carrier = c1 {\n x = 10;\n knit f0;\n}'], ['editor.paste']));
assert.equal(pasted.steps[0].unitType, 'empty_frame');
assert.equal(pasted.steps[0].source, 'with Carrier = c1 {}');
assert.equal(pasted.steps.filter(s => s.unitType === 'assignment').length, 1);
verify(pasted, 'with Carrier = c1 {\n x = 10;\n knit f0;\n}');
const strings = context.buildUnitDataset(dataset(['x = "a;b{c}"; y = 2;'], ['editor.paste']));
assert.equal(strings.steps.length, 2);
verify(strings, 'x = "a;b{c}"; y = 2;');
const incomplete = context.buildUnitDataset(dataset(['for x in [', 'for x in ['], ['', 'run.requested']));
assert.equal(incomplete.steps[0].unitType, 'incomplete_unit');
verify(incomplete, 'for x in [');
const mapped = context.mapRawAnnotations(units, {2: ['ERROR']});
assert.equal(mapped[0][0], 'ERROR');
console.log('Syntactic units: reconstruction, event coverage, boundaries, paste frames, strings, and annotation migration passed');
for (const name of ['s4', '5f427', '691de']) {
  const original = JSON.parse(fs.readFileSync(`annotation_data/${name}.json`, 'utf8'));
  const saved = JSON.stringify(original);
  const transformed = context.buildUnitDataset(original);
  assert.equal(JSON.stringify(original), saved);
  assert.equal(transformed.steps.at(-1).source, original.steps.at(-1).source);
  assert.equal(new Set(transformed.steps.flatMap(s => s.rawStepIndices)).size, original.steps.length);
  console.log(`${name}: ${original.steps.length} original steps → ${transformed.steps.length} units/events, final source and originals preserved`);
}
