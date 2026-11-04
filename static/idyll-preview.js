const React = require("react");
const ReactDOM = require("react-dom");
const IdyllDocument = require("idyll-document/dist/cjs/runtime").default;

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
names.forEach(name => { components[name] = modules[name].default; });
components.checkbox = components.boolean;

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

window.addEventListener("message", event => {
  if (event.source !== parent || event.data?.type !== "idyll.render" || !event.data.ast) return;
  errorOutput.hidden = true;
  errorOutput.textContent = "";
  rendering = true;
  try {
    ReactDOM.unmountComponentAtNode(container);
    ReactDOM.render(React.createElement(PreviewBoundary, null,
      React.createElement(IdyllDocument, { ast: event.data.ast, components, datasets: {}, context: context => {
        context.onUpdate(() => parent.postMessage({ type: "idyll.interaction" }, "*"));
      } })), container);
  } catch (error) {
    reportError(error);
  }
});
