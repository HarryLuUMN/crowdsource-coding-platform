const React = require("react");

const h = React.createElement;
const colors = ["#2563eb", "#d97706", "#7c3aed", "#059669", "#dc2626"];
const fields = ["month", "category", "sales"];

function rows(value, name, reference = false) {
  if (!Array.isArray(value) || value.length > 500) throw new Error(`${name} must be an array of at most 500 sales records.`);
  value.forEach(row => {
    if (!row || typeof row !== "object" || typeof row.month !== "string" || !Number.isFinite(Date.parse(row.month)) || typeof row.sales !== "number" || !Number.isFinite(row.sales) || (!reference && typeof row.category !== "string")) {
      throw new Error(`${name} records require a valid month, a numeric sales value${reference ? "" : ", and a category"}.`);
    }
  });
  return value;
}

function Table({ data = [], label = "Sales records" }) {
  const records = rows(data, "Table data");
  return h("div", { className: "idyll-table-wrapper", "data-table-count": records.length },
    h("table", { className: "idyll-sales-table", "aria-label": label },
      h("thead", null, h("tr", null, fields.map(field => h("th", { key: field, scope: "col" }, field)))),
      h("tbody", null, records.map((row, index) => h("tr", { key: index, "data-record": JSON.stringify(row) }, fields.map(field => h("td", { key: field }, row[field])))))),
    !records.length && h("p", { className: "idyll-empty-data" }, "No rows to display."));
}

function Chart({ data = [], type = "point", x = "month", y = "sales", color = "category", focus = "", reference = [], highlight = [], label = "Monthly sales chart" }) {
  if (!["point", "line"].includes(type) || x !== "month" || y !== "sales" || color !== "category") {
    throw new Error('Chart supports type:"point" or type:"line", x:"month", y:"sales", and color:"category".');
  }
  if (typeof focus !== "string") throw new Error("Chart focus must be a category name or an empty string.");
  const records = rows(data, "Chart data");
  const baseline = rows(reference, "Chart reference", true);
  const emphasized = rows(highlight, "Chart highlight");
  const keys = new Set(emphasized.map(row => `${row.month}|${row.category}|${row.sales}`));
  const categories = [...new Set(records.map(row => row.category))].sort();
  const months = [...new Set([...records, ...baseline].map(row => row.month))].sort((a, b) => Date.parse(a) - Date.parse(b));
  const width = 640, height = 340, left = 60, right = 20, top = 24, bottom = 62;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const maximum = Math.max(1, ...records.map(row => row.sales), ...baseline.map(row => row.sales));
  const minimum = Math.min(0, ...records.map(row => row.sales), ...baseline.map(row => row.sales));
  const px = month => left + (months.length < 2 ? plotWidth / 2 : months.indexOf(month) / (months.length - 1) * plotWidth);
  const py = value => top + (maximum - value) / (maximum - minimum) * plotHeight;
  const categoryColor = category => colors[categories.indexOf(category) % colors.length];
  const path = values => values.slice().sort((a, b) => Date.parse(a.month) - Date.parse(b.month)).map(row => `${px(row.month)},${py(row.sales)}`).join(" ");
  const marks = [];
  if (type === "line") categories.forEach(category => marks.push(h("polyline", {
    key: `line-${category}`, className: "idyll-chart-line", "data-category": category,
    points: path(records.filter(row => row.category === category)), fill: "none", stroke: categoryColor(category), strokeWidth: 2.5,
    opacity: focus && category !== focus ? 0.18 : 1
  })));
  if (baseline.length) marks.push(h("polyline", {
    key: "reference", className: "idyll-chart-reference", points: path(baseline), fill: "none", stroke: "#334155", strokeWidth: 2.5, strokeDasharray: "7 5"
  }));
  records.forEach((row, index) => {
    const selected = keys.has(`${row.month}|${row.category}|${row.sales}`);
    marks.push(h("circle", {
      key: `point-${index}`, className: selected ? "idyll-chart-point idyll-chart-highlight" : "idyll-chart-point",
      "data-record": JSON.stringify(row), "data-highlighted": String(selected), cx: px(row.month), cy: py(row.sales), r: selected ? 7 : 4,
      fill: categoryColor(row.category), stroke: selected ? "#111827" : "white", strokeWidth: selected ? 2 : 1,
      opacity: focus && row.category !== focus ? 0.18 : 1
    }, h("title", null, `${row.month} · ${row.category}: ${row.sales}`)));
  });
  const ticks = [0, 1, 2, 3, 4].map(index => minimum + (maximum - minimum) * index / 4);
  return h("figure", { className: "idyll-sales-chart", "data-chart-type": type, "data-chart-focus": focus, "data-chart-data": JSON.stringify(records), "data-chart-reference": JSON.stringify(baseline), "data-chart-highlight": JSON.stringify(emphasized) },
    h("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": label },
      h("title", null, label),
      ticks.map((value, index) => h("g", { key: `tick-${index}` },
        h("line", { x1: left, x2: width - right, y1: py(value), y2: py(value), stroke: "#e2e8f0" }),
        h("text", { x: left - 9, y: py(value) + 4, textAnchor: "end", fontSize: 12, fill: "#475569" }, Number(value.toFixed(2))))),
      h("line", { x1: left, x2: width - right, y1: height - bottom, y2: height - bottom, stroke: "#94a3b8" }),
      months.map(month => h("text", { key: month, x: px(month), y: height - bottom + 22, textAnchor: "middle", fontSize: 11, fill: "#475569" }, month.slice(0, 7))),
      h("text", { x: left + plotWidth / 2, y: height - 9, textAnchor: "middle", fontSize: 13, fill: "#334155" }, "Month"),
      h("text", { x: 15, y: top + plotHeight / 2, textAnchor: "middle", fontSize: 13, fill: "#334155", transform: `rotate(-90 15 ${top + plotHeight / 2})` }, "Sales"), marks),
    h("figcaption", { className: "idyll-chart-legend" }, categories.map(category => h("span", { key: category }, h("i", { style: { background: categoryColor(category) } }), category)), baseline.length > 0 && h("span", null, h("i", { style: { background: "#334155" } }), "Reference")),
    !records.length && h("p", { className: "idyll-empty-data" }, "No data to plot."));
}

function Step({ index, children }) {
  if (!Number.isInteger(index) || index < 0 || index > 20) throw new Error("Step index must be an integer from 0 to 20.");
  return h("section", { className: "idyll-story-step", "data-story-step": index, style: { gridRow: index + 1 } }, children);
}

function Pinned({ children }) {
  return h("aside", { className: "idyll-pinned", "aria-label": "Pinned visualization and controls" }, children);
}

class Scroller extends React.Component {
  constructor(props) {
    super(props);
    this.root = React.createRef();
    this.state = { count: 1 };
    this.updateStep = this.updateStep.bind(this);
    this.schedule = this.schedule.bind(this);
    this.frame = null;
  }
  componentDidMount() {
    const count = this.root.current.querySelectorAll(".idyll-story-step").length;
    this.setState({ count });
    window.addEventListener("scroll", this.schedule, { passive: true });
    window.addEventListener("resize", this.schedule);
    this.schedule();
  }
  componentDidUpdate() {
    this.schedule();
  }
  componentWillUnmount() {
    window.removeEventListener("scroll", this.schedule);
    window.removeEventListener("resize", this.schedule);
    if (this.frame !== null) cancelAnimationFrame(this.frame);
  }
  schedule() {
    if (this.frame === null) this.frame = requestAnimationFrame(this.updateStep);
  }
  updateStep() {
    this.frame = null;
    if (!this.root.current) return;
    const steps = [...this.root.current.querySelectorAll(".idyll-story-step")];
    let active = steps.length ? Number(steps[0].dataset.storyStep) : 0;
    steps.forEach(step => {
      if (step.getBoundingClientRect().top <= window.innerHeight * 0.4) active = Number(step.dataset.storyStep);
    });
    steps.forEach(step => {
      const selected = Number(step.dataset.storyStep) === active;
      step.dataset.active = String(selected);
      if (selected) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    if (active !== this.props.step) this.props.updateProps({ step: active });
  }
  render() {
    return h("div", { className: "idyll-scroller", "data-active-step": this.props.step, style: { "--story-steps": this.state.count }, ref: this.root }, this.props.children);
  }
}

module.exports = { Table, Chart, Scroller, Step, Pinned };
