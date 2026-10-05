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
    spec.data = { values: data };
    const compiled = sandbox.vegaLite.compile(spec).spec;
    view = new sandbox.vega.View(sandbox.vega.parse(compiled), {
      renderer: "none", loader: { load: () => Promise.reject(new Error("External data is disabled")) },
    });
    await view.runAsync();
    process.stdout.write(JSON.stringify({ ok: true }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  } finally {
    if (view) view.finalize();
  }
});
