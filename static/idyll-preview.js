const React = require("react");
const ReactDOM = require("react-dom");
const IdyllDocument = require("idyll-document/dist/cjs/runtime").default;
const studyComponents = require("./idyll-study-components");
const falafel = require("falafel");

const names = ["range", "display", "dynamic", "conditional", "button", "boolean", "select", "text-input", "switch", "case", "default", "inline", "text-container", "h1", "h2", "h3", "h4", "h5", "h6"];
const components = {};
const modules = {
  range: require("idyll-components/dist/cjs/range"),
  display: require("idyll-components/dist/cjs/display"),
  dynamic: require("idyll-components/dist/cjs/dynamic"),
  conditional: require("idyll-components/dist/cjs/conditional"),
  button: require("idyll-components/dist/cjs/button"),
  boolean: require("idyll-components/dist/cjs/boolean"),
  select: require("idyll-components/dist/cjs/select"),
  "text-input": require("idyll-components/dist/cjs/text-input"),
  switch: require("idyll-components/dist/cjs/switch"),
  case: require("idyll-components/dist/cjs/case"),
  default: require("idyll-components/dist/cjs/default"),
  inline: require("idyll-components/dist/cjs/inline"),
  "text-container": require("idyll-components/dist/cjs/text-container"),
  h1: require("idyll-components/dist/cjs/h1"),
  h2: require("idyll-components/dist/cjs/h2"),
  h3: require("idyll-components/dist/cjs/h3"),
  h4: require("idyll-components/dist/cjs/h4"),
  h5: require("idyll-components/dist/cjs/h5"),
  h6: require("idyll-components/dist/cjs/h6")
};
names.forEach(name => { components[name] = modules[name].default || modules[name]; });
components.checkbox = components.boolean;
Object.entries(studyComponents).forEach(([name, component]) => { components[name.toLowerCase()] = component; });

const container = document.getElementById("article");
const errorOutput = document.getElementById("preview-error");
let rendering = false;

function reportError(error) {
  const message = error?.message || String(error);
  errorOutput.hidden = false;
  errorOutput.textContent = message;
  parent.postMessage({ type: "idyll.render_error", message }, "*");
}

class PreviewBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  componentDidCatch(error) {
    this.setState({ failed: true });
    reportError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

window.addEventListener("error", event => reportError(event.error || event.message));
window.addEventListener("unhandledrejection", event => reportError(event.reason));
const originalError = console.error.bind(console);
console.error = (...args) => {
  originalError(...args);
  if (rendering) reportError(args.map(value => value?.message || String(value)).join(" "));
};
const originalWarn = console.warn.bind(console);
console.warn = (...args) => {
  originalWarn(...args);
  if (rendering && args.some(value => String(value).includes("Error occurred in Idyll expression"))) {
    reportError("An Idyll expression could not be evaluated. Check its syntax and variable references.");
  }
};

function normalizeDatasetBindings(original, datasets) {
  const ast = JSON.parse(JSON.stringify(original));
  const declarations = [];
  const identifiers = new Set();
  const walk = (node, callback) => {
    callback(node);
    (node.children || []).forEach(child => walk(child, callback));
  };
  walk(ast, node => {
    if (["var", "derived", "data"].includes(node.type)) declarations.push(node);
    Object.values(node.properties || {}).forEach(property => {
      if (property.type === "expression") falafel(property.value, { ecmaVersion: 2020 }, part => {
        if (part.type === "Identifier") identifiers.add(part.name);
      });
    });
  });
  const names = new Map();
  declarations.forEach(node => {
    const name = node.properties.name.value;
    let index = names.size;
    let replacement = `__idyllStudyBinding_${index}`;
    while (identifiers.has(replacement)) replacement = `__idyllStudyBinding_${++index}`;
    names.set(name, replacement);
    identifiers.add(replacement);
  });
  const boundInCallback = (node, name) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (["ArrowFunctionExpression", "FunctionExpression"].includes(parent.type) && parent.params.some(parameter => parameter.type === "Identifier" && parameter.name === name)) return true;
    }
    return false;
  };
  const rewrite = expression => falafel(expression, { ecmaVersion: 2020 }, node => {
    if (node.type !== "Identifier" || !names.has(node.name) || boundInCallback(node, node.name)) return;
    const parent = node.parent;
    if (parent?.type === "MemberExpression" && parent.property === node && !parent.computed) return;
    if (parent?.type === "Property" && parent.shorthand && parent.value === node) node.update(`${node.name}: ${names.get(node.name)}`);
    else if (parent?.type !== "Property" || parent.key !== node || parent.computed) node.update(names.get(node.name));
  }).toString();
  walk(ast, node => {
    if (["var", "derived", "data"].includes(node.type)) node.properties.name.value = names.get(node.properties.name.value);
    Object.values(node.properties || {}).forEach(property => {
      if (property.type === "variable" && names.has(property.value)) property.value = names.get(property.value);
      if (property.type === "expression") property.value = rewrite(property.value);
    });
  });
  return { ast, datasets: Object.fromEntries(Object.entries(datasets).map(([name, value]) => [names.get(name) || name, value])) };
}

window.addEventListener("message", event => {
  if (event.source !== parent || event.data?.type !== "idyll.render" || !event.data.ast) return;
  errorOutput.hidden = true;
  errorOutput.textContent = "";
  rendering = true;
  try {
    const suppliedRows = event.data.datasets?.sales;
    const suppliedData = suppliedRows === undefined ? {} : { sales: suppliedRows.map(row => ({ month: row.month, category: row.category, sales: row.sales })) };
    const { ast, datasets } = suppliedRows === undefined ? { ast: event.data.ast, datasets: {} } : normalizeDatasetBindings(event.data.ast, suppliedData);
    ReactDOM.unmountComponentAtNode(container);
    ReactDOM.render(React.createElement(PreviewBoundary, null,
      React.createElement(IdyllDocument, { ast, components, datasets, context: context => {
        context.update(datasets);
        context.onUpdate(() => parent.postMessage({ type: "idyll.interaction" }, "*"));
      } })), container);
  } catch (error) {
    reportError(error);
  }
});
