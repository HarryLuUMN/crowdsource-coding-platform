const fs = require('node:fs');
const path = require('node:path');
const registry = require('../programming-checkers/registry.json');

try {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const entry = registry[input.task_id];
  const tests = entry?.startsWith('idyll/')
    ? require(path.join(__dirname, '../programming-checkers', entry)).check(input.ast, input.data)
    : require('../programming-checkers/shared/idyll_legacy.cjs').check(input.ast, input.task_id);
  process.stdout.write(JSON.stringify({tests}));
} catch (error) {
  process.stdout.write(JSON.stringify({tests:[{id:'safe-evaluation',label:'Supported reactive program',passed:false,message:error.message}]}));
}
