import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

for (const method of ["log", "info", "debug", "warn"]) {
  console[method] = (...args) => process.stderr.write(args.map(String).join(" ") + "\n");
}

const root = new URL("../", import.meta.url);
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;

const { compile, step, isOptimized, finalStage, nextStage, toSVG, showError } = await import("@penrose/core");

async function run(source) {
  if (typeof source !== "string" || !source.trim()) {
    return { ok: false, error: { type: "SourceError", message: "Write a Penrose Substance program before running." } };
  }
  const compiled = await compile({
    substance: source,
    domain: fs.readFileSync(fileURLToPath(new URL("static/penrose-domain.dsl", root)), "utf8"),
    style: fs.readFileSync(fileURLToPath(new URL("static/penrose-style.sty", root)), "utf8"),
    variation: "autodsl-eval-v1",
  });
  if (compiled.isErr()) {
    return { ok: false, error: { type: compiled.error.errorType || "PenroseError", message: showError(compiled.error) } };
  }
  let state = compiled.value;
  const deadline = Date.now() + 12000;
  let rounds = 0;
  while (!isOptimized(state) || !finalStage(state)) {
    if (Date.now() >= deadline || rounds++ >= 1000) {
      return { ok: false, error: { type: "OptimizationTimeout", message: "The diagram layout did not converge within the execution limit. Check for conflicting relationships." } };
    }
    if (isOptimized(state)) state = nextStage(state);
    const result = step(state, { until: () => Date.now() >= deadline });
    if (result.isErr()) {
      return { ok: false, error: { type: "OptimizationError", message: showError(result.error) } };
    }
    state = result.value;
  }
  const svg = await toSVG(state, async () => undefined, "autodsl");
  return { ok: true, svg: svg.outerHTML, stdout: "Penrose Substance compiled and diagram layout completed.", error: null };
}

try {
  const request = JSON.parse(fs.readFileSync(0, "utf8"));
  const result = await run(request.source);
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: { type: "PenroseError", message: error.message || String(error) } }));
} finally {
  dom.window.close();
}
