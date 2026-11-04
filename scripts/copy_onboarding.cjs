const fs = require("node:fs");
const path = require("node:path");
const source = path.dirname(require.resolve("intro.js/package.json"));
const target = path.join(__dirname, "../static/vendor");
fs.mkdirSync(target, { recursive: true });
for (const [input, output] of [
  ["minified/intro.min.js", "introjs.js"],
  ["minified/introjs.min.css", "introjs.css"],
  ["license.md", "introjs.LICENSE"]
]) fs.copyFileSync(path.join(source, input), path.join(target, output));
