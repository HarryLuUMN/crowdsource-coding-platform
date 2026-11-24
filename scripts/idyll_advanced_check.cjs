const path = require('node:path');
const registry = require('../programming-checkers/registry.json');

function check(ast, taskId, data) {
  if (!['idyll-explorer-v2', 'idyll-story-v2'].includes(taskId)) throw Error('Unknown advanced Idyll task.');
  return require(path.join(__dirname, '../programming-checkers', registry[taskId])).check(ast, data);
}

module.exports = {check};
