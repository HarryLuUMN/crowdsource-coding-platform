const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("static/app.js", "utf8");
const policy = source.match(/const localTaskSelection = [\s\S]*?;/)[0];
const controls = source.match(/function setStudyControlsEnabled\(enabled\) \{[\s\S]*?\n\}/)[0];

for (const hostname of ["localhost", "127.0.0.1", "[::1]", "example.com", "crowdsource-code-platform-production.up.railway.app"]) {
  for (const enabled of [true, false]) {
    const context = {
      window: { location: { hostname, protocol: "http:", search: "?preview=1" } },
    };
    for (const key of ["languageSelect", "taskSelect", "editor", "runButton", "submitButton", "resetButton"]) {
      context[key] = {};
    }
    vm.runInNewContext(`${policy}\n${controls}\nsetStudyControlsEnabled(${enabled});`, context);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    assert.equal(context.languageSelect.disabled, !enabled || !local);
    assert.equal(context.taskSelect.disabled, !enabled || !local);
    assert.equal(context.runButton.disabled, !enabled);
    assert.equal(context.editor.disabled, !enabled);
  }
}
console.log("Task selector environment lock checks passed");
