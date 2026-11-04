const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const runner = path.join(__dirname, "../scripts/idyll_compile.cjs");
function run(source) {
  const process = spawnSync("node", [runner], {
    input: JSON.stringify({ source }), encoding: "utf8", timeout: 10000
  });
  assert.equal(process.status, 0, process.stderr);
  return JSON.parse(process.stdout);
}

const article = run("[var name:\"quantity\" value:2 /]\n# Calculator\n[Range value:quantity min:0 max:10 /]\n[Display value:`quantity * 3` /]");
assert.equal(article.ok, true, JSON.stringify(article.error));
assert.ok(article.ast);
assert.equal(run("[Range value:").ok, false);
assert.equal(run("[UnknownComponent /]").ok, false);
assert.equal(run("[data name:\"remote\" source:\"https://example.com\" /]").ok, false);
assert.equal(run("---js\nmodule.exports = process.exit(93)\n---\nHello").ok, false);
assert.equal(run("[var name:\"x\" value:`process.exit(93)` /]").ok, true);
assert.equal(run("").ok, false);
console.log("Idyll compiler and execution-boundary checks passed.");
