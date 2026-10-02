const assert = require('node:assert/strict');
const {detectAnnotationRules, annotationStatements, ANNOTATION_RULES} = (() => {
  const rules = require('../static/annotation-rules.js');
  return rules;
})();
const codebook = JSON.parse(require('node:fs').readFileSync('annotation_data/s4.json')).codebook;
function run(items) {
  return detectAnnotationRules({codebook, steps: items.map((s, i) => ({index:i, sourceSteps:[i+1], payload:{}, ...s}))}).detections;
}
assert.equal(annotationStatements('x = "a;b";').length, 1);
assert.equal(annotationStatements('x = "unterminated;'), null);
assert.equal(annotationStatements('with direction:{ knit n;'), null);
let detections = run([
  {event:'editor.paste', previousSource:'', source:'x=1;'},
  {event:'run.requested', source:'x=1;'},
  {event:'run.completed', source:'x=1;', payload:{check:{passed_count:0,total_count:1}}},
  {event:'editor.edit', previousSource:'x=1;', source:'x=2;'},
  {event:'run.requested', source:'x=2;'},
]);
assert(detections.some(d => d.code==='PASTE_FIRST' && d.status==='auto'));
assert(detections.some(d => d.code==='PASTE_DOC' && d.status==='candidate'));
assert(detections.some(d => d.code==='VALID_WRONG_OUTPUT' && d.status==='auto'));
assert(detections.some(d => d.code==='LOCAL_AFTER_OUTPUT' && d.status==='auto'));
assert(!detections.some(d => d.code==='INCREMENTAL'));
detections = run([
  {event:'run.requested', source:'x=1;'},
  {event:'run.completed', source:'x=1;'},
  {event:'editor.edit', previousSource:'x=1;', source:'x=1; y=2;'},
  {event:'run.requested', source:'x=1; y=2;'},
  {event:'run.completed', source:'x=1; y=2;', payload:{check:{passed_count:5,total_count:5}}},
]);
assert(detections.some(d=>d.code==='INCREMENTAL' && d.status==='candidate'));
assert(!detections.some(d=>d.code==='VALID_WRONG_OUTPUT'));
detections = run([
  {event:'editor.paste',previousSource:'',source:'x=1;'},
  {event:'editor.edit',previousSource:'x=1;',source:''},
  {event:'editor.paste',previousSource:'',source:'y=2;'},
]);
assert(detections.some(d=>d.code==='DELETE_REPASTE' && d.status==='auto'));
detections = run([
  {event:'editor.paste',previousSource:'',source:'x=1;'},
  {event:'editor.edit',previousSource:'x=1;',source:'x=2;'},
  {event:'editor.edit',previousSource:'x=2;',source:''},
  {event:'editor.paste',previousSource:'',source:'y=2;'},
]);
assert(!detections.some(d=>d.code==='DELETE_REPASTE'));
detections = run([{event:'run.failed',source:'unknown;',payload:{error_type:'NameError',error_message:'name unknown is not defined'}}]);
assert(detections.some(d=>d.code==='IDENTIFIER_ISSUE' && d.status==='auto'));
assert(detections.every(d=>d.code!=='INCORRECT_BINDING' || d.status==='candidate'));
assert(detections.every(d=>d.evidence.events.length && d.ruleVersion));
console.log('Annotation rule evidence and false-positive tests passed');
