const assert = require("node:assert/strict");
const { documentationReadingSnapshot, attachDocumentationReading } = require("../static/documentation-reading.js");
global.document = { hidden: false };
const listeners = new Map();
const block = (tagName, textContent, top, bottom, id = "") => ({ tagName, textContent, id, querySelector: () => null, getBoundingClientRect: () => ({top, bottom, left: 0, right: 300}) });
const doc = {
  readyState: "complete",
  documentElement: { scrollHeight: 2000 },
  querySelectorAll: () => [block("H2", "Carrier", -30, -10, "carrier"), block("P", "Visible paragraph", -5, 80), block("PRE", "knit Loops;", 100, 150), block("P", "Not visible", 600, 700)],
  addEventListener: (name, callback) => listeners.set(name, callback),
  removeEventListener: (name) => listeners.delete(name),
};
const view = {
  location: { href: "http://localhost/documentation/quickstart.html#carrier", pathname: "/documentation/quickstart.html", hash: "#carrier" },
  innerWidth: 300, innerHeight: 500, scrollX: 0, scrollY: 123,
  addEventListener: (name, callback) => listeners.set(name, callback),
  removeEventListener: (name) => listeners.delete(name),
};
const frame = {contentDocument: doc, contentWindow: view, addEventListener: (name, callback) => listeners.set("load", callback)};
const snapshot = documentationReadingSnapshot(frame);
assert.equal(snapshot.scroll_y, 123);
assert.equal(snapshot.guide_kind, "documentation");
assert.equal(snapshot.visible_blocks.length, 2);
assert.equal(snapshot.visible_blocks[0].section, "Carrier");
assert.equal(snapshot.visible_blocks[0].partially_visible, true);
assert.equal(snapshot.position_start, "reading-block-1");
assert.ok(snapshot.observed_at);
const events = [];
const finish = attachDocumentationReading(frame, (type, payload) => events.push({type, payload}));
const tutorialView = { ...view, location: { href: "http://localhost/tutorial.html", pathname: "/tutorial.html", hash: "" } };
const tutorialFrame = { ...frame, contentWindow: tutorialView };
assert.equal(documentationReadingSnapshot(tutorialFrame).guide_kind, "tutorial");
listeners.get("click")({ target: { closest: () => ({href: "http://localhost/documentation/language.html", getAttribute: () => "/documentation/language.html"}) } });
assert.equal(events.at(-1).payload.target_path, "/documentation/language.html");
assert.equal(events.at(-1).payload.page_url, view.location.href);
listeners.get("hashchange")();
assert.equal(events.at(-1).payload.navigation_kind, "fragment");
listeners.get("scroll")();
setTimeout(() => {
  assert.equal(events.at(-1).type, "guide.documentation_scrolled");
  assert.equal(events.at(-1).payload.phase, "settled");
  listeners.get("load")();
  finish();
  assert.equal(events.at(-1).type, "guide.documentation_view_left");
  console.log("Documentation reading events verified");
}, 250);
