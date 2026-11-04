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

const { compileDomain, compileSubstance, compile, step, isOptimized, finalStage, nextStage, toSVG, showError } = await import("@penrose/core");

async function run(source) {
  if (typeof source !== "string" || !source.trim()) {
    return { ok: false, error: { type: "SourceError", message: "Write a Penrose Substance program before running." } };
  }
  const domain = fs.readFileSync(fileURLToPath(new URL("static/penrose-domain.dsl", root)), "utf8");
  const substance = compileSubstance(source, compileDomain(domain).value);
  const compiled = await compile({
    substance: source,
    domain,
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
  const entries = value => typeof value?.entries === "function" ? [...value.entries()] : Object.entries(value || {});
  const number = value => typeof value === "number" ? value : value?.val;
  const evidence = {
    objects: Object.fromEntries(entries(substance.value.objs).map(([name, type]) => [name, type.name.value])),
    labels: Object.fromEntries(entries(substance.value.labels).map(([name, label]) => [name, label.value])),
    predicates: substance.value.ast.statements.filter(statement => statement.tag === "ApplyPredicate")
      .map(statement => ({ name: statement.name.value, args: statement.args.map(arg => arg.value) })),
    shapes: Object.fromEntries(state.computeShapes(state.varyingValues).filter(shape => shape.shapeType === "Circle")
      .map(shape => [shape.path.access.parent.substanceObject.name, {
        type: shape.shapeType,
        center: shape.center.contents.map(number),
        radius: number(shape.r.contents),
      }])),
  };
  return { ok: true, evidence, svg: svg.outerHTML, stdout: "Penrose Substance compiled and diagram layout completed.", error: null };
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
