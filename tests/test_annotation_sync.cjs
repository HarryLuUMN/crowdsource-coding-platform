const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/annotation.js', 'utf8');
const context = vm.createContext({ structuredClone });
vm.runInContext(source.slice(source.indexOf('function mergeDatasetLabels('), source.indexOf('function saveAnnotations(')), context);
function merge(server, local, base) { return JSON.parse(JSON.stringify(context.mergeDatasetLabels(server, local, base))); }
assert.deepEqual(merge({ 48: ['TRIAL_ERROR'] }, { 48: [] }, { 48: [] }), { 48: ['TRIAL_ERROR'] });
assert.deepEqual(merge({ 51: ['NEW', 'OLD'] }, { 51: ['LOCAL'] }, { 51: ['OLD'] }), { 51: ['NEW', 'LOCAL'] });
assert.deepEqual(merge({}, { 51: ['OLD'] }, { 51: ['OLD'] }), {});
assert.deepEqual(merge({ 48: ['TRIAL_ERROR'] }, { 48: [], 51: ['LEGACY'] }), { 48: ['TRIAL_ERROR'] });
assert.deepEqual(merge({ 10: ['SERVER'] }, { 10: [] }, { 10: ['SERVER'] }), { 10: [] });
console.log('Dataset sync: server updates, local additions/deletions, server removals and legacy cache precedence passed');
