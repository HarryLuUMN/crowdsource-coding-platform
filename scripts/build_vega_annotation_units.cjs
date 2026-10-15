const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({});
for (const name of ['annotation-session', 'annotation-unit-text', 'annotation-unit-edits', 'annotation-unit-reading', 'annotation-units']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'static', `${name}.js`), 'utf8'), context);
}
const traces = [
  { key: '5e219', session: 'd7438308-77d5-47c3-8d59-a8283bc8a14a' },
  { key: '5f67b', session: '2326a06f-8ef5-4840-8172-bf99abb992c9' },
];

async function main() {
  const base = process.argv[2] || 'https://crowdsource-code-platform-production.up.railway.app';
  let cookie = '';
  if (process.argv[3]) {
    const variables = JSON.parse(execFileSync(process.argv[3], ['variables', '--json'], { encoding: 'utf8' }));
    const response = await fetch(base + '/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: variables.TRACE_ADMIN_TOKEN }),
    });
    assert(response.ok, 'Administrator authentication failed');
    cookie = response.headers.get('set-cookie').split(';')[0];
  }
  async function get(route) {
    const response = await fetch(base + route, { headers: { Cookie: cookie } });
    assert(response.ok, `Read failed: ${response.status} ${route}`);
    const payload = await response.json();
    assert.notEqual(payload.ok, false, `Read failed: ${route}`);
    return payload;
  }
  const original = JSON.parse(fs.readFileSync(path.join(root, 'annotation_data/s4.json'), 'utf8'));
  const codebook = original.codebook.filter(group => group.group !== 'KnitScript challenges');
  const outputs = [];
  for (const trace of traces) {
    const target = path.join(root, 'annotation_data', `${trace.key}-units.json`);
    assert(!fs.existsSync(target), `Refusing to overwrite existing annotations: ${target}`);
    const prefix = `/api/admin/sessions/${trace.session}`;
    const detail = await get(prefix);
    const stream = await get(prefix + '/events?limit=10000');
    const initial = await get(prefix + '/file?path=code/source-initial.ks');
    assert.equal(detail.manifest.task_id, 'vega-lite-sales-v1');
    assert.equal(detail.manifest.status, 'completed');
    assert.equal(detail.trace_integrity.raw_complete, true);
    assert.equal(stream.events.length, detail.manifest.event_count);
    const raw = context.buildSessionDataset(detail, stream.events, codebook, initial.content || '');
    const dataset = context.buildUnitDataset(raw);
    dataset.rules = { version: 'not-run-vega', detections: [] };
    dataset.ruleDecisions = {};
    dataset.ruleReviewNotes = {};
    dataset.processing = {
      version: dataset.granularity, sourceSession: trace.session,
      sourceEventCount: stream.events.length, language: 'vega-lite',
      method: 'legacy-delimiter-based',
      limitations: 'Legacy delimiter segmentation is not a JSON parser. Synthetic intermediate states may be invalid JSON. No automatic property annotations were applied.',
    };
    dataset.trace.dataNote += ' Vega-Lite processed with the legacy delimiter method, not a JSON parser. No property annotations applied.';
    assert.equal(dataset.steps.at(-1).source, raw.steps.at(-1).source);
    assert.equal(new Set(dataset.steps.flatMap(step => step.rawStepIndices)).size, raw.steps.length);
    assert(raw.steps.some(step => step.event === 'session.ended'));
    outputs.push({ target, dataset });
  }
  // Validate both sessions before writing either output.
  for (const { target, dataset } of outputs) {
    fs.writeFileSync(target, JSON.stringify(dataset) + '\n');
    console.log(`${dataset.trace.label}: ${dataset.rawSteps.length} raw events -> ${dataset.steps.length} steps`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
