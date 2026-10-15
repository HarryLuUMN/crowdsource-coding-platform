const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
for (const name of ['annotation-unit-text', 'annotation-unit-edits', 'annotation-unit-reading', 'annotation-units']) {
  vm.runInContext(fs.readFileSync(`static/${name}.js`, 'utf8'), context);
}
const helperOrder = ['annotation-unit-text', 'annotation-unit-edits', 'annotation-unit-reading', 'annotation-units'];
const html = fs.readFileSync('static/annotation.html', 'utf8');
const builder = fs.readFileSync('scripts/build_annotation_units.cjs', 'utf8');
for (const loader of [html, builder]) {
  let previousPosition = -1;
  for (const name of helperOrder) {
    const position = loader.indexOf(name);
    assert(position > previousPosition, `${name} must load after its helpers`);
    previousPosition = position;
  }
}
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
assert.equal(context.classifyEditUnit('insert', {}, 'x = 1;', false), 'assignment');
assert.equal(context.classifyEditUnit('insert', {}, 'knit Loops;', false), 'operation');
assert.equal(context.classifyEditUnit('insert', {}, 'with Carrier as c1:{', true), 'empty_frame');
assert.equal(context.classifyEditUnit('replace', { removed: 'a=1;b=2;', inserted: 'a=3;' }, '', false), 'unresolved_compound_edit');
const priorEdit = typing.steps[0];
assert.equal(context.startsNewEditGroup(priorEdit, { ...typing.steps[1], elapsedMs: 5000 }), false);
assert.equal(context.startsNewEditGroup(priorEdit, { ...typing.steps[1], elapsedMs: 5001 }), true);
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
const reverted = context.buildUnitDataset(dataset(['x', '']));
verify(reverted, '');
const cursor = { source: 'frame{}', offset: 6, frames: 1 };
assert.equal(context.applyEditPiece(cursor, '\n}', 'insert', false, ''), false);
assert.equal(cursor.source, 'frame{\n}');
assert.equal(cursor.frames, 0);
const readingRaw = dataset(['x;', 'x;', 'x;', 'x;', 'x;', 'x;'], ['editor.edit', 'guide.scroll', 'guide.open', 'run.requested', 'guide.scroll', 'guide.scroll']);
for (const index of [1, 2, 4, 5]) readingRaw.steps[index].reading = { title: `Guide ${index}`, location: `Page ${index}`, excerpt: `Text ${index}`, precision: 'Visibility is not attention.' };
readingRaw.annotations[2] = ['SECOND'];
const readingUnits = context.buildUnitDataset(readingRaw);
assert.equal(readingUnits.steps.length, 4);
assert.equal(readingUnits.steps[1].event, 'reading.sequence');
assert.equal(readingUnits.steps[1].rawSteps.length, 2);
assert.equal(readingUnits.steps[1].elapsedStartMs, 100);
assert.equal(readingUnits.steps[1].elapsedEndMs, 200);
assert.equal(readingUnits.steps[1].reading.excerpt, 'Text 1\n\nText 2');
assert.equal(readingUnits.annotations[1].join(','), 'LABEL,SECOND');
assert.equal(readingUnits.steps[1].annotationProvenance.length, 2);
assert.equal(context.buildUnitDataset(readingRaw, { mergeReading: false }).steps.length, 6);
verify(readingUnits, 'x;');
const oldReadingUnits = context.buildUnitDataset(readingRaw, { mergeReading: false });
context.state = { dataset: readingUnits };
context.semanticDataset = null;
context.annotationReadOnly = false;
context.STORAGE_PREFIX = 'trace-annotations:';
context.structuredClone = structuredClone;
const priorStorage = JSON.stringify({ annotations: { 1: ['LOCAL'], 2: ['OTHER'], 3: [] }, ruleDecisions: { saved: 'confirm' } });
context.localStorage = { getItem: key => key.endsWith(':syntactic-unit-v1') ? priorStorage : null };
const annotationSource = fs.readFileSync('static/annotation.js', 'utf8');
vm.runInContext(annotationSource.slice(annotationSource.indexOf('function storageKey()'), annotationSource.indexOf('function saveAnnotations()')), context);
context.loadAnnotations();
assert.equal(context.state.annotations[1].join(','), 'LOCAL,OTHER');
assert.equal(context.state.annotations[2].length, 0);
assert.equal(context.state.decisions.saved, 'confirm');
assert.equal(oldReadingUnits.steps[3].event, 'run.requested');
assert.equal(mapped[0][0], 'ERROR');
console.log('Syntactic units: reconstruction, event coverage, boundaries, paste frames, strings, and annotation migration passed');
// Freeze pre-refactor outputs; review these hashes after fixture changes.
const baselineDigests = {
  s4: 'dfa2bb74112af53ce351e95aa615b9c26eb1a44da33e0cae8d2a5cf6b3f0332d',
  '5f427': '0e6a1ee4eece8f1e3295689db82816c97d527756f6a7885ffd9e5aacbd0c9ecb',
  '691de': '573192fe9c99f88bd95c541c22cc74dd676584481ea20231e892b20b2d23cf5b',
  '67658': 'bb05e7a16075dc2a18975bb259d60349aefdf23991a806987e6fe4c529d0d354',
  '67aa5': 'b8f9a305ec06232a1e0778841aee7a23acd9f3c8dbb0d5c367b97dde4782d374',
  '65fda': 'dec1c624f9d26b01d40fb2438a674e3b615cf15d87c89584c7d07748b4c6db3f',
};
for (const [name, expected] of Object.entries(baselineDigests)) {
  const saved = JSON.parse(fs.readFileSync(`annotation_data/${name}-units.json`, 'utf8'));
  const input = { ...saved, steps: saved.rawSteps, annotations: saved.rawAnnotations || {} };
  const before = JSON.stringify(input);
  const output = context.buildUnitDataset(input);
  const digest = require('node:crypto').createHash('sha256').update(JSON.stringify(output)).digest('hex');
  assert.equal(digest, expected, `${name}: processing output changed`);
  assert.equal(JSON.stringify(input), before, `${name}: input was mutated`);
}
for (const name of ['s4', '5f427', '691de']) {
  const original = JSON.parse(fs.readFileSync(`annotation_data/${name}.json`, 'utf8'));
  const saved = JSON.stringify(original);
  const transformed = context.buildUnitDataset(original);
  assert.equal(JSON.stringify(original), saved);
  assert.equal(transformed.steps.at(-1).source, original.steps.at(-1).source);
  assert.equal(new Set(transformed.steps.flatMap(s => s.rawStepIndices)).size, original.steps.length);
  console.log(`${name}: ${original.steps.length} original steps → ${transformed.steps.length} units/events, final source and originals preserved`);
}
