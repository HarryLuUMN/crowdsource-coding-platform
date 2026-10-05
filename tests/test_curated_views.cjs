const assert = require('node:assert/strict');
const fs = require('node:fs');
for (const [name, count] of [['s4', 123], ['5f427', 190], ['691de', 175]]) {
  const original = JSON.parse(fs.readFileSync(`annotation_data/${name}.json`, 'utf8'));
  const dataset = JSON.parse(fs.readFileSync(`annotation_data/${name}-units.json`, 'utf8'));
  assert.equal(dataset.granularity, 'curated-semantic-v1');
  assert.equal(dataset.steps.length, original.steps.length);
  assert.equal(dataset.rawSteps.length, count);
  assert.equal(new Set(dataset.rawSteps.flatMap(s => s.sourceSteps)).size, count);
  dataset.steps.forEach((step, index) => {
    assert.equal(step.source, original.steps[index].source);
    assert.equal(step.previousSource, original.steps[index].previousSource);
    assert.equal(step.event, original.steps[index].event);
    for (const rawIndex of step.rawStepIndices) {
      const raw = dataset.rawSteps[rawIndex];
      assert(step.sourceSteps.includes(raw.sourceSteps[0]));
      assert(step.event === raw.event || step.event === 'editor.edit_group' && raw.event.startsWith('editor.'));
    }
  });
  assert(dataset.steps.some(step => step.rawStepIndices.length === 0));
  console.log(`${name}: original semantic states preserved; ${count} genuine events; checkpoint mappings do not collide with event sequence IDs`);
}
