const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const sandbox = { console: { warn() {}, error() {}, log() {} }, setTimeout, clearTimeout, structuredClone };
vm.createContext(sandbox);
for (const file of ["vega-5.30.0.min.js", "vega-lite-5.21.0.min.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../static/vendor", file), "utf8"), sandbox);
}
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => { input += chunk; });
process.stdin.on("end", async () => {
  let view;
  try {
    const { spec, data } = JSON.parse(input);
    if (data !== undefined) spec.data = { values: data };
    const compiled = sandbox.vegaLite.compile(spec).spec;
    view = new sandbox.vega.View(sandbox.vega.parse(compiled), {
      renderer: "none", loader: { load: () => Promise.reject(new Error("External data is disabled")) },
    });
    await view.runAsync();
    const definitions = new Map();
    function indexMarks(marks) {
      for (const mark of marks || []) {
        if (mark.name) definitions.set(mark.name, mark);
        indexMarks(mark.marks);
      }
    }
    indexMarks(compiled.marks);
    const marks = [], titles = [];
    function visit(item) {
      if (item.mark && item.mark.role === "mark" && item.datum && item.opacity !== 0) {
        const definition = definitions.get(item.mark.name);
        const channels = {};
        for (const [key, encoding] of Object.entries(definition?.encode?.update || {})) {
          if (encoding.field) channels[key] = sandbox.vega.field(encoding.field)(item.datum);
        }
        marks.push({ type: item.mark.marktype, channels, datum: item.datum, appearance: { x: item.x, y: item.y, width: item.width, height: item.height, size: item.size, fill: item.fill, stroke: item.stroke, opacity: item.opacity } });
      }
      if (["axis-title", "title-text"].includes(item.mark?.role) && item.text) titles.push({ role: item.mark.role, text: String(item.text) });
      for (const child of item.items || []) visit(child);
    }
    visit(view.scenegraph().root);
    process.stdout.write(JSON.stringify({ ok: true, evidence: { marks, titles } }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  } finally {
    if (view) view.finalize();
  }
});
