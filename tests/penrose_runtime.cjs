const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

function run(source) {
  const child = spawnSync(process.execPath, [path.join(__dirname, "../scripts/penrose_compile.mjs")], {
    input: JSON.stringify({ source }), encoding: "utf8", timeout: 25000,
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}

const nested = run("Set A, B\nSubset(A, B)\nAutoLabel All");
assert.equal(nested.ok, true, JSON.stringify(nested.error));
assert.match(nested.svg, /<svg/);
assert.match(nested.svg, /<circle/);
assert.equal(nested.svg, run("Set A, B\nSubset(A, B)\nAutoLabel All").svg);

const points = run("Set A, B\nPoint p\nIntersecting(A, B)\nIn(p, A)\nNotIn(p, B)\nAutoLabel All");
assert.equal(points.ok, true, JSON.stringify(points.error));
assert.match(points.svg, /<circle/);

for (const source of ["", "Set A\nSubset(A, missing)", "Point p\nSubset(p, p)", "Set A\nSubset("]) {
  const failure = run(source);
  assert.equal(failure.ok, false, source);
  assert.ok(failure.error.message);
  assert.equal(failure.svg, undefined);
}
console.log("Penrose runtime: SVG rendering, deterministic layout, relationships, and diagnostics passed.");
