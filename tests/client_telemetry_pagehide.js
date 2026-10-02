const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createElement() {
  return {
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    disabled: false,
    selectionStart: 0,
    scrollTop: 0,
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    removeAttribute() {},
    setAttribute() {},
    querySelector() { return createElement(); },
    focus() {},
    close() {},
    showModal() {},
  };
}

const windowListeners = new Map();
const fetchCalls = [];
const beaconCalls = [];
const storedValues = new Map();
let rejectEventUploads = false;
let rejectSessionCreation = false;
let rejectEndSession = false;
let reportMissingSession = false;
let uuidCounter = 0;
const context = {
  Blob,
  URLSearchParams,
  clearTimeout() {},
  console,
  crypto: { randomUUID: () => `uuid-${++uuidCounter}` },
  document: {
    hidden: false,
    querySelector: () => createElement(),
    querySelectorAll: () => [],
    addEventListener() {},
  },
  fetch: async (url, options = {}) => {
    fetchCalls.push({ url, options });
    if (url === "/api/sessions") {
      if (rejectSessionCreation) return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
      return { ok: true, status: 201, json: async () => ({ session: { session_id: `recovered-${uuidCounter}` } }), text: async () => "" };
    }
    if (url === "/api/sessions/end") {
      return { ok: !rejectEndSession, status: rejectEndSession ? 503 : 200, json: async () => ({}), text: async () => "" };
    }
    if (url === "/api/events" && reportMissingSession) {
      reportMissingSession = false;
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
    }
    if (url === "/api/events" && (options.keepalive || rejectEventUploads)) {
      throw new TypeError("simulated interrupted upload");
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  },
  history: { replaceState() {} },
  localStorage: {
    getItem: (key) => storedValues.get(key) ?? null,
    setItem: (key, value) => storedValues.set(key, String(value)),
    removeItem: (key) => storedValues.delete(key),
  },
  navigator: {
    language: "en-US",
    clipboard: { writeText: async () => {} },
    sendBeacon: (url, body) => {
      beaconCalls.push({ url, body });
      return false;
    },
  },
  performance: { now: () => 1000 },
  setInterval() {},
  setTimeout() {},
  window: {
    innerWidth: 1280,
    innerHeight: 720,
    location: { search: "", pathname: "/", assign() {} },
    addEventListener(type, callback) { windowListeners.set(type, callback); },
  },
};
context.globalThis = context;

const appSource = fs.readFileSync("static/app.js", "utf8");
const readingSource = fs.readFileSync("static/documentation-reading.js", "utf8");
const hooks = `
  globalThis.__telemetryTest = {
    begin(sessionId) {
      studyStarted = true;
      currentStudyPhase = "formal";
      telemetrySessionId = sessionId;
      telemetryStorageKey = "knitscript-telemetry-outbox:test";
      persistTelemetryOutbox();
    },
    simulateReload() {
      telemetrySessionId = null;
      telemetrySeq = 0;
      pendingEvents.splice(0);
      return restoreTelemetryOutbox();
    },
    disconnectSession() {
      telemetrySessionId = null;
      persistTelemetryOutbox();
    },
    configureSourceRestore(sourceKey, outboxKey) {
      currentStudyPhase = "formal";
      sourceStorageKey = sourceKey;
      telemetryStorageKey = outboxKey;
    },
    loadInitialSource() {
      setInitialSource();
      return editor.value;
    },
    setPhase(phase) { currentStudyPhase = phase; },
    recordEvent,
    flushEvents,
    finishTelemetrySession,
    pendingEvents,
    getSessionId() { return telemetrySessionId; },
  };
`;
vm.runInNewContext(`${readingSource}\n${appSource}\n${hooks}`, context, { filename: "static/app.js" });

async function run() {
  const sourceKey = "knitscript-source:participant";
  const outboxKey = "knitscript-outbox:participant";
  context.__telemetryTest.configureSourceRestore(sourceKey, outboxKey);
  storedValues.set(sourceKey, "previous passing solution");
  assert.equal(
    context.__telemetryTest.loadInitialSource(),
    "",
    "a completed or abandoned source without an active trace must not prefill a new formal attempt",
  );
  assert.equal(storedValues.has(sourceKey), false, "stale formal source must be removed");

  storedValues.set(sourceKey, "in-progress source");
  storedValues.set(outboxKey, JSON.stringify({
    version: 1,
    task_id: "stockinette-swatch-v1",
    session_id: "active-session",
    pending_events: [],
  }));
  assert.equal(
    context.__telemetryTest.loadInitialSource(),
    "in-progress source",
    "an active trace must retain reload recovery",
  );
  storedValues.delete(sourceKey);
  storedValues.delete(outboxKey);

  context.__telemetryTest.begin("session-pagehide-test");
  context.__telemetryTest.recordEvent("editor.edit", { inserted_text: "x" });
  await context.__telemetryTest.flushEvents();

  assert.equal(
    context.__telemetryTest.pendingEvents.length,
    0,
    "normal telemetry uploads must not use the browser keepalive quota",
  );
  assert.equal(fetchCalls.find((call) => call.url === "/api/events").options.keepalive, undefined);

  context.__telemetryTest.setPhase("practice");
  context.__telemetryTest.recordEvent("editor.edit", { inserted_text: "practice" });
  assert.equal(context.__telemetryTest.pendingEvents.length, 0, "practice activity must not enter the trace pipeline");
  context.__telemetryTest.setPhase("formal");

  rejectEventUploads = true;
  context.__telemetryTest.recordEvent("editor.edit", { inserted_text: "must survive reload" });
  await context.__telemetryTest.flushEvents();
  assert.ok(
    [...storedValues.keys()].some((key) => key.startsWith("knitscript-telemetry-outbox:")),
    "failed event uploads must be persisted outside page memory before a reload",
  );
  assert.equal(context.__telemetryTest.simulateReload(), true, "a reload must restore the active trace outbox");
  assert.equal(context.__telemetryTest.pendingEvents.length, 1, "the failed event must survive a reload");
  rejectEventUploads = false;
  await context.__telemetryTest.flushEvents();
  assert.equal(context.__telemetryTest.pendingEvents.length, 0, "restored events must upload after connectivity returns");

  context.__telemetryTest.recordEvent("editor.edit", { inserted_text: "before server restart" });
  reportMissingSession = true;
  await context.__telemetryTest.flushEvents();
  assert.match(context.__telemetryTest.getSessionId(), /^recovered-/, "a missing server session must be replaced");
  assert.equal(context.__telemetryTest.pendingEvents.length, 0, "the recovered session marker must upload immediately");

  context.__telemetryTest.disconnectSession();
  rejectSessionCreation = true;
  context.__telemetryTest.recordEvent("editor.edit", { inserted_text: "while session service is offline" });
  await context.__telemetryTest.flushEvents();
  assert.equal(context.__telemetryTest.simulateReload(), true, "queued events without a session must survive reload");
  assert.equal(context.__telemetryTest.getSessionId(), null, "an unavailable session service must not invent a session id");
  rejectSessionCreation = false;
  await context.__telemetryTest.flushEvents();
  assert.match(context.__telemetryTest.getSessionId(), /^recovered-/, "session creation must retry after recovery");
  assert.equal(context.__telemetryTest.pendingEvents.length, 0, "pre-session events must upload after session recovery");

  rejectEventUploads = true;
  for (let index = 0; index < 120; index += 1) {
    context.__telemetryTest.recordEvent("editor.edit", { inserted_text: "x".repeat(128), index });
  }

  windowListeners.get("pagehide")({ persisted: false });

  assert.equal(
    context.__telemetryTest.pendingEvents.length,
    120,
    "pagehide must retain every unacknowledged event without prematurely ending the session",
  );
  assert.ok(
    beaconCalls.some((call) => call.url === "/api/events"),
    "pagehide must attempt bounded event uploads instead of one monolithic end-session body",
  );
  assert.ok(
    beaconCalls.every((call) => call.body.size < 64 * 1024),
    "every keepalive payload must stay below the browser 64 KiB limit",
  );
  assert.equal(
    beaconCalls.some((call) => call.url === "/api/sessions/end"),
    false,
    "pagehide must not finalize a session that can still be resumed",
  );

  rejectEventUploads = false;
  rejectEndSession = true;
  assert.equal(await context.__telemetryTest.finishTelemetrySession(), false, "failed finalization must block completion");
  assert.ok(storedValues.has("knitscript-telemetry-outbox:test"), "failed finalization must retain recovery state");
  rejectEndSession = false;
  storedValues.set(sourceKey, "accepted solution");
  assert.equal(await context.__telemetryTest.finishTelemetrySession(), true, "finalization must retry successfully");
  assert.equal(storedValues.has("knitscript-telemetry-outbox:test"), false, "successful finalization must clear recovery state");
  assert.equal(storedValues.has(sourceKey), false, "successful finalization must clear the saved source");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
