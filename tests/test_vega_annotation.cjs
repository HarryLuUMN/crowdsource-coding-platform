const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
for (const name of ['annotation-unit-text', 'annotation-unit-edits', 'annotation-unit-reading', 'annotation-units']) {
  vm.runInContext(fs.readFileSync(`static/${name}.js`, 'utf8'), context);
}
for (const [key, rawCount, unitCount] of [['5e219', 1050, 186], ['5f67b', 2176, 406]]) {
  const dataset = JSON.parse(fs.readFileSync(`annotation_data/${key}-units.json`, 'utf8'));
  assert.equal(dataset.trace.task, 'vega-lite-sales-v1');
  assert.equal(dataset.trace.status, 'completed');
  assert.equal(dataset.rawSteps.length, rawCount);
  assert.equal(dataset.steps.length, unitCount);
  assert.equal(new Set(dataset.steps.flatMap(step => step.rawStepIndices)).size, rawCount);
  assert.equal(dataset.steps.at(-1).source, dataset.rawSteps.at(-1).source);
  assert.doesNotThrow(() => JSON.parse(dataset.steps.at(-1).source));
  assert(dataset.rawSteps.some(step => step.event === 'session.ended'));
  assert(dataset.rawSteps.some(step => step.event === 'submit.accepted' && step.payload.check.passed));
  assert.equal(dataset.codebook.length, 2);
  assert.equal(dataset.automaticLabeling.ruleVersion, 'properties-v1');
  assert.equal(Object.keys(dataset.annotations).length, key === '5e219' ? 6 : 31);
  assert(dataset.rules.detections.every(rule => rule.status === 'auto'));
  assert(dataset.rules.detections.every(rule => Array.isArray(rule.evidence.events)));
  const rebuilt = context.buildUnitDataset({ ...dataset, steps: dataset.rawSteps, annotations: dataset.rawAnnotations });
  assert.deepEqual(JSON.parse(JSON.stringify(rebuilt.steps)), dataset.steps);
  console.log(`${key}: legacy output reproduced, raw coverage complete, passed submission retained`);
}
