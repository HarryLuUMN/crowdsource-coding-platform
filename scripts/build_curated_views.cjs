const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const context = vm.createContext({});
for (const name of ['annotation-session', 'annotation-rules']) vm.runInContext(fs.readFileSync(`static/${name}.js`, 'utf8'), context);
const base = process.argv[2] || 'https://crowdsource-code-platform-production.up.railway.app';
async function main() {
  let cookie = '';
  if (process.argv[3]) {
    const variables = JSON.parse(execFileSync(process.argv[3], ['variables', '--json'], { encoding: 'utf8' }));
    const response = await fetch(base + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: variables.TRACE_ADMIN_TOKEN }) });
    if (!response.ok) throw new Error('Administrator authentication failed');
    cookie = response.headers.get('set-cookie').split(';')[0];
  }
  async function get(path) {
    const response = await fetch(base + path, { headers: { Cookie: cookie } });
    if (!response.ok) throw new Error(`Read failed: ${response.status} ${path}`);
    return response.json();
  }
  for (const name of ['s4', '5f427', '691de']) {
    const curated = (await get(`/api/admin/annotation-dataset/${name}`)).dataset;
    const prefix = '/api/admin/sessions/' + curated.trace.id;
    const detail = await get(prefix);
    const stream = await get(prefix + '/events?limit=10000');
    if (stream.events.length !== detail.manifest.event_count) throw new Error('Incomplete event stream');
    const initial = await get(prefix + '/file?path=code/source-initial.ks');
    const raw = context.buildSessionDataset(detail, stream.events, curated.codebook, initial.content || '');
    const steps = curated.steps.map(step => {
      const indices = raw.steps.filter(event => step.sourceSteps.includes(event.sourceSteps[0]) &&
        (step.event === event.event || step.event === 'editor.edit_group' && event.event.startsWith('editor.'))).map(event => event.index);
      return { ...step, rawStepIndices: indices, rawSteps: indices.map(index => raw.steps[index]),
        provenance: indices.length ? 'recorded_events' : 'saved_checkpoint_or_curated_evidence' };
    });
    const dataset = { ...curated, granularity: 'curated-semantic-v1', curatedSteps: curated.steps,
      steps, rawSteps: raw.steps, rawAnnotations: {}, rules: context.detectAnnotationRules(curated) };
    dataset.trace.dataNote += ` Raw view contains ${raw.steps.length} recorded events; later saved checkpoints remain in semantic view, not fabricated raw events.`;
    for (const step of steps) for (const index of step.rawStepIndices) {
      dataset.rawAnnotations[index] = [...new Set([...(dataset.rawAnnotations[index] || []), ...(dataset.annotations[step.index] || [])])];
    }
    fs.writeFileSync(`annotation_data/${name}-units.json`, JSON.stringify(dataset) + '\n');
    console.log(`${name}: ${steps.length} curated semantic steps; ${raw.steps.length} genuine raw events; ${steps.filter(s => !s.rawStepIndices.length).length} steps without raw-event mapping`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
