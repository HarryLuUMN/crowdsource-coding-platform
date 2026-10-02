const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('static/annotation-session.js', 'utf8'), context);
const detail = {manifest: {session_id: 'test', participant_id: '67aa5', task_id: 'task'}};
const events = [
  {seq: 1, type: 'editor.paste', elapsed_ms: 0, payload: {range_start: 0, range_end: 0, inserted_text: 'x😀', deleted_text: '', source_length_after: 3}},
  {seq: 2, type: 'editor.edit', elapsed_ms: 1, payload: {range_start: 1, range_end: 3, inserted_text: 'y', deleted_text: '😀', source_length_after: 2}},
  {seq: 3, type: 'run.completed', elapsed_ms: 2, payload: {check: {passed_count: 4, total_count: 5}}},
];
const dataset = context.buildSessionDataset(detail, events, [], '', {3: {codes: ['VALID_WRONG_OUTPUT'], reason: 'Fails requirement'}});
assert.equal(dataset.steps[1].source, 'xy');
assert.equal(dataset.steps[1].previousSource, 'x😀');
assert.equal(dataset.steps[2].source, 'xy');
assert.equal(dataset.annotations[2][0], 'VALID_WRONG_OUTPUT');
assert.throws(() => context.buildSessionDataset(detail, [{seq: 1, type: 'editor.edit', payload: {...events[0].payload, deleted_text: 'bad'}}], []), /Source mismatch/);
console.log('Annotation session reconstruction passed');
