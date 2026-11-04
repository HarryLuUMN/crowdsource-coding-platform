const fs = require("node:fs");
const compile = require("idyll-compiler");

const components = new Set([
  "root", "var", "derived", "range", "display", "dynamic", "conditional",
  "button", "boolean", "checkbox", "select", "textinput", "switch", "case",
  "default", "inline", "textcontainer", "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "div", "span", "strong", "em", "b", "i", "ul", "ol", "li", "br",
  "hr", "pre", "code", "blockquote", "a", "label", "section", "article"
]);

function validate(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach(validate);
    return;
  }
  if (node.type === "data") throw new Error("Data imports are not supported in this coding environment.");
  if (node.name && !components.has(node.name.toLowerCase().replace(/-/g, ""))) {
    throw new Error(`Unsupported component: ${node.name}. Use the provided built-in components.`);
  }
  if (node.children) validate(node.children);
}

async function main() {
  try {
    const { source } = JSON.parse(fs.readFileSync(0, "utf8"));
    if (typeof source !== "string" || !source.trim()) throw new Error("Write some Idyll before running.");
    if (source.length > 100000) throw new Error("Source is limited to 100,000 characters.");
    if (/^\s*---/.test(source)) throw new Error("Front matter is not supported in this coding environment.");
    const ast = await compile(source, { async: true, spellcheck: false });
    validate(ast);
    process.stdout.write(JSON.stringify({ ok: true, ast, error: null, stdout: "Idyll compiled. Interactive expressions run in the isolated preview." }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, ast: null, error: { type: error.name || "IdyllError", message: error.message || String(error) }, stdout: "" }));
  }
}

main();
