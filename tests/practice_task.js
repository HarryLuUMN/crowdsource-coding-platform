const assert = require("node:assert/strict");
const PracticeTask = require("../static/practice-task.js");

assert.equal(PracticeTask.check('print("Hello, coding platform!")').passed, true);
assert.equal(PracticeTask.check("print('Hello, coding platform!')").passed, true);
assert.equal(PracticeTask.check("# practice\nprint('Hello, coding platform!');").passed, true);
assert.equal(PracticeTask.check("print('hello')").passed, false);
assert.equal(PracticeTask.check("print('Hello, coding platform!')\nprint('again')").passed, false);
assert.equal(PracticeTask.check("import os").passed, false);

console.log("practice task checks passed");
