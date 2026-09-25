const assert = require("node:assert/strict");
const { parseKnitout } = require("../static/knitout-visualizer.js");

const knitout = `;!knitout-2
inhook 1
tuck + f0 1
tuck + f1 1
knit - f1 1
knit - f0 1
knit + f0 1
knit + f1 1
xfer f1 b1
drop f0
`;

const model = parseKnitout(knitout);
assert.equal(model.operationCount, 9);
assert.equal(model.loops.length, 6);
assert.equal(model.courses.length, 3);
assert.deepEqual(model.courses.map((course) => course.direction), ["+", "-", "+"]);
assert.equal(model.connections.length, 4);
assert.deepEqual(model.loops.map(({ id, course, needle, bed, command }) => ({ id, course, needle, bed, command })), [
  { id: 0, course: 0, needle: 0, bed: "f", command: "tuck" },
  { id: 1, course: 0, needle: 1, bed: "f", command: "tuck" },
  { id: 2, course: 1, needle: 1, bed: "f", command: "knit" },
  { id: 3, course: 1, needle: 0, bed: "f", command: "knit" },
  { id: 4, course: 2, needle: 0, bed: "f", command: "knit" },
  { id: 5, course: 2, needle: 1, bed: "f", command: "knit" },
]);

const empty = parseKnitout(";!knitout-2\ninhook 1\nreleasehook\n");
assert.equal(empty.loops.length, 0);
assert.equal(empty.courses.length, 0);
