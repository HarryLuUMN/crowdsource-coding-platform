const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({});
for (const name of ['annotation-session', 'annotation-units', 'annotation-rules']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'static', `${name}.js`), 'utf8'), context);
}
const base = process.argv[2] || 'http://127.0.0.1:8000';
async function get(route) {
  const response = await fetch(base + route);
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(`${route}: ${JSON.stringify(payload.error)}`);
  return payload;
}
async function main() {
  const codebook = JSON.parse(fs.readFileSync(path.join(root, 'annotation_data/s4.json'), 'utf8')).codebook;
  for (const name of ['67658', '67aa5', '65fda']) {
    const review = JSON.parse(fs.readFileSync(path.join(root, 'annotation_data', `${name}-review.json`), 'utf8'));
    const prefix = `/api/admin/sessions/${review.session}`;
    const [detail, stream, initial] = await Promise.all([get(prefix), get(prefix + '/events?limit=10000'), get(prefix + '/file?path=code/source-initial.ks')]);
    assert.equal(stream.events.length, detail.manifest.event_count, 'Incomplete raw event stream');
    const raw = context.buildSessionDataset(detail, stream.events, codebook, initial.content || '', review.review);
    const rules = context.detectAnnotationRules(raw);
    const dataset = context.buildUnitDataset(raw);
    dataset.ruleDecisions = review.ruleDecisions || {};
    dataset.ruleReviewNotes = review.ruleReviewNotes || {};
    dataset.rules = { ...rules, detections: rules.detections.flatMap(d => dataset.steps.filter(s => s.rawStepIndices.includes(d.step)).map(s => ({ ...d, step: s.index }))) };
    dataset.processing = { version: dataset.granularity, sourceSession: review.session, sourceEventCount: stream.events.length };
    assert.equal(dataset.steps.at(-1).source, raw.steps.at(-1).source);
    assert.equal(new Set(dataset.steps.flatMap(s => s.rawStepIndices)).size, raw.steps.length);
    for (const step of raw.steps) {
      for (const code of raw.annotations[step.index] || []) {
        assert(dataset.steps.some(s => s.rawStepIndices.includes(step.index) && dataset.annotations[s.index]?.includes(code)), 'Annotation was lost');
      }
    }
    fs.writeFileSync(path.join(root, 'annotation_data', `${name}-units.json`), JSON.stringify(dataset) + '\n');
    console.log(`${name}: ${raw.steps.length} original events → ${dataset.steps.length} units/events; full event coverage and labels verified`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
