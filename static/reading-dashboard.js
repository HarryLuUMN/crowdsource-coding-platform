"use strict";

const $ = (selector) => document.querySelector(selector);
const state = { sessions: [], events: [], index: 0, timer: null, sessionId: null, pendingReplay: null };
const documentFrame = $("#documentReplay");
const blockSelector = "h1,h2,h3,h4,h5,h6,p,pre,li,dt,dd";

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(date);
}

function pageName(path) {
  if (!path || path === "/documentation/") return "Documentation home";
  return decodeURIComponent(path.split("/").at(-1).replace(/\.html$/, "").replaceAll("_", " "));
}

function eventKind(event) {
  if (event.type.endsWith("link_clicked")) return "Link";
  if (event.type.endsWith("navigated")) return "Page";
  if (event.type.endsWith("view_left")) return "Leave";
  return event.payload?.phase === "settled" ? "Pause" : "Scroll";
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({ ok: false, error: { message: `Request failed (${response.status}).` } }));
  if (!response.ok) { const error = new Error(payload.error?.message || "Request failed."); error.status = response.status; throw error; }
  return payload;
}

function showLogin(message = "") {
  $("#dashboardView").hidden = true;
  $("#loginView").hidden = false;
  $("#loginMessage").textContent = message;
}

function stop() {
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
  $("#playButton").textContent = "Play";
}

function readingEvents(events) {
  return events.filter((event) => event.type?.startsWith("guide.documentation"));
}

function journey(events) {
  const pages = [];
  events.filter((event) => event.type.endsWith("navigated")).forEach((event, index) => {
    const path = event.payload?.document_path || event.payload?.page_url;
    if (!pages.length || pages.at(-1).path !== path) pages.push({ path, eventIndex: events.indexOf(event), time: event.client_timestamp, number: index + 1 });
  });
  return pages;
}

function updateMetrics() {
  const events = state.events;
  const pages = new Set(events.map((event) => event.payload?.document_path?.split("#")[0]).filter(Boolean));
  const first = new Date(events[0]?.client_timestamp).getTime();
  const last = new Date(events.at(-1)?.client_timestamp).getTime();
  const depth = events.reduce((maximum, event) => {
    const payload = event.payload || {};
    const available = Number(payload.document_height || 0) - Number(payload.viewport_height || 0);
    return Math.max(maximum, available > 0 ? Number(payload.scroll_y || 0) / available : 0);
  }, 0);
  $("#eventMetric").textContent = events.length;
  $("#pageMetric").textContent = pages.size;
  $("#durationMetric").textContent = Number.isFinite(last - first) ? `${Math.max(0, Math.round((last - first) / 1000))}s` : "0s";
  $("#depthMetric").textContent = `${Math.round(depth * 100)}%`;
}

function renderJourney() {
  const container = $("#journey");
  container.replaceChildren();
  journey(state.events).forEach((page, position) => {
    const button = document.createElement("button");
    button.className = "journey-item";
    button.type = "button";
    button.dataset.eventIndex = page.eventIndex;
    const title = document.createElement("strong");
    title.textContent = `${position + 1}. ${pageName(page.path)}`;
    const detail = document.createElement("span");
    detail.textContent = formatDate(page.time);
    button.append(title, detail);
    button.addEventListener("click", () => { stop(); show(page.eventIndex); });
    container.append(button);
  });
}

function renderTimeline() {
  const timeline = $("#timeline");
  timeline.replaceChildren();
  state.events.forEach((event, index) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `marker ${eventKind(event).toLowerCase()}`;
    marker.title = `${eventKind(event)} · ${formatDate(event.client_timestamp)}`;
    marker.addEventListener("click", () => { stop(); show(index); });
    timeline.append(marker);
  });
}

function addContext(label, value) {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value ?? "—";
  $("#context").append(term, description);
}

function replayUrl(payload) {
  let path = payload.document_path || "";
  if (!path.startsWith("/documentation/")) {
    try {
      const url = new URL(payload.page_url);
      path = url.pathname + url.hash;
    } catch {
      path = "/documentation/";
    }
  }
  return path.startsWith("/documentation/") ? path : "/documentation/";
}

function replayBlocks(doc) {
  return [...doc.querySelectorAll(blockSelector)].filter((block) => !block.querySelector("p,pre,li"));
}

function recordedBlock(doc, blocks, snapshot) {
  if (snapshot.block_id && !snapshot.block_id.startsWith("reading-block-")) {
    const byId = doc.getElementById(snapshot.block_id);
    if (byId) return byId;
  }
  const indexed = blocks[Number(snapshot.block_index)];
  if (indexed) return indexed;
  const text = (snapshot.text || "").trim();
  return text ? blocks.find((block) => block.textContent.trim().startsWith(text.slice(0, 120))) : null;
}

function focusSnapshot(snapshots, viewportHeight) {
  const center = Number(viewportHeight || 0) / 2;
  return snapshots.reduce((best, snapshot) => {
    const midpoint = (Number(snapshot.viewport_top || 0) + Number(snapshot.viewport_bottom || 0)) / 2;
    const distance = Math.abs(midpoint - center);
    return !best || distance < best.distance ? { snapshot, distance } : best;
  }, null)?.snapshot;
}

function applyReplay(event, expectedIndex) {
  if (expectedIndex !== state.index || !documentFrame.contentDocument) return;
  const payload = event.payload || {};
  const doc = documentFrame.contentDocument;
  const view = documentFrame.contentWindow;
  let style = doc.getElementById("reading-replay-style");
  if (!style) {
    style = doc.createElement("style");
    style.id = "reading-replay-style";
    style.textContent = `
      .reading-trace-visible { position:relative; border-radius:4px; outline:2px solid rgba(229,255,111,.5); outline-offset:3px; background:rgba(229,255,111,.12)!important; box-shadow:0 0 0 5px rgba(229,255,111,.04); transition:background .15s ease,outline-color .15s ease; }
      .reading-trace-visible.reading-trace-partial { outline-style:dashed; }
      .reading-trace-focus { outline:3px solid #e5ff6f; background:rgba(229,255,111,.3)!important; box-shadow:0 0 24px rgba(229,255,111,.22); }
      .reading-trace-focus::before { content:"LIKELY READING HERE"; position:absolute; z-index:20; top:-18px; left:0; padding:3px 7px; border-radius:4px 4px 0 0; color:#11120f; background:#e5ff6f; font:700 9px/1.3 ui-monospace,monospace; letter-spacing:.06em; }
    `;
    doc.head.append(style);
    doc.addEventListener("click", (clickEvent) => clickEvent.preventDefault(), true);
  }
  doc.querySelectorAll(".reading-trace-visible").forEach((block) => {
    block.classList.remove("reading-trace-visible", "reading-trace-partial", "reading-trace-focus");
    ["outline", "outline-offset", "background", "box-shadow"].forEach((property) => block.style.removeProperty(property));
  });
  const blocks = replayBlocks(doc);
  const snapshots = Array.isArray(payload.visible_blocks) ? payload.visible_blocks : [];
  const focused = focusSnapshot(snapshots, payload.viewport_height);
  let matched = 0;
  snapshots.forEach((snapshot) => {
    const block = recordedBlock(doc, blocks, snapshot);
    if (!block) return;
    matched += 1;
    block.classList.add("reading-trace-visible");
    block.style.setProperty("outline", `3px ${snapshot.partially_visible ? "dashed" : "solid"} rgba(229,255,111,.72)`, "important");
    block.style.setProperty("outline-offset", "4px", "important");
    block.style.setProperty("background", "rgba(229,255,111,.16)", "important");
    if (snapshot.partially_visible) block.classList.add("reading-trace-partial");
    if (snapshot === focused) {
      block.classList.add("reading-trace-focus");
      block.style.setProperty("outline", "4px solid #e5ff6f", "important");
      block.style.setProperty("background", "rgba(229,255,111,.34)", "important");
      block.style.setProperty("box-shadow", "0 0 28px rgba(229,255,111,.3)", "important");
    }
  });
  view.scrollTo(Number(payload.scroll_x || 0), Number(payload.scroll_y || 0));
  $("#blockMeta").textContent = `${matched} of ${snapshots.length} recorded blocks highlighted`;
  $("#documentLoading").hidden = true;
  documentFrame.hidden = false;
}

function renderReplay(event) {
  const expectedIndex = state.index;
  const url = replayUrl(event.payload || {});
  state.pendingReplay = { event, expectedIndex };
  $("#documentPlaceholder").hidden = true;
  const current = documentFrame.contentWindow?.location;
  const currentUrl = current && current.pathname.startsWith("/documentation/") ? current.pathname + current.hash : "";
  if (currentUrl !== url) {
    $("#documentLoading").hidden = false;
    documentFrame.hidden = true;
    documentFrame.src = url;
    return;
  }
  window.requestAnimationFrame(() => applyReplay(event, expectedIndex));
}

function show(index) {
  if (!state.events.length) return;
  state.index = Math.min(state.events.length - 1, Math.max(0, index));
  const event = state.events[state.index];
  const payload = event.payload || {};
  const blocks = Array.isArray(payload.visible_blocks) ? payload.visible_blocks : [];
  $("#eventBadge").textContent = eventKind(event);
  $("#pagePath").textContent = payload.document_path || payload.page_url || "Documentation";
  $("#eventTime").textContent = formatDate(event.client_timestamp);
  $("#scrollPosition").textContent = `${Number(payload.scroll_y || 0).toLocaleString()} px / ${Number(payload.document_height || 0).toLocaleString()} px`;
  $("#viewportMeta").textContent = `${payload.viewport_width || "—"} × ${payload.viewport_height || "—"} viewport`;
  $("#blockMeta").textContent = `${blocks.length} visible blocks`;
  renderReplay(event);
  $("#scrubber").value = String(state.index);
  $("#counter").textContent = `${state.index + 1} / ${state.events.length}`;
  [...$("#timeline").children].forEach((item, itemIndex) => item.classList.toggle("active", itemIndex === state.index));
  const currentPath = (payload.document_path || "").split("#")[0];
  [...$("#journey").children].forEach((item) => {
    const pageEvent = state.events[Number(item.dataset.eventIndex)];
    item.classList.toggle("active", (pageEvent?.payload?.document_path || "").split("#")[0] === currentPath);
  });
  $("#context").replaceChildren();
  addContext("Event", `#${event.seq} · ${eventKind(event)}`);
  addContext("Page", pageName(payload.document_path));
  addContext("Visible range", `${payload.position_start || "—"} → ${payload.position_end || "—"}`);
  addContext("Section", [...new Set(blocks.map((block) => block.section).filter(Boolean))].join(" · ") || "—");
  addContext("Target", payload.target_path || payload.target_url || "—");
  addContext("Platform visible", payload.platform_visible === false ? "No" : "Yes");
}

async function loadSession(sessionId) {
  stop();
  state.sessionId = sessionId;
  const payload = await api(`/api/admin/sessions/${encodeURIComponent(sessionId)}/events?limit=10000`);
  state.events = readingEvents(payload.events);
  state.index = 0;
  $("#scrubber").max = String(Math.max(0, state.events.length - 1));
  updateMetrics(); renderJourney(); renderTimeline();
  if (state.events.length) show(0);
  else { documentFrame.hidden = true; $("#documentPlaceholder").hidden = false; $("#documentPlaceholder").innerHTML = '<p class="empty">This session has no reading events.</p>'; $("#counter").textContent = "0 / 0"; }
}

async function loadSessions() {
  try {
    const payload = await api("/api/admin/sessions");
    state.sessions = payload.sessions;
    const select = $("#sessionSelect");
    select.replaceChildren();
    state.sessions.forEach((session) => {
      const option = document.createElement("option"); option.value = session.session_id; option.textContent = `${session.prolific_pid || session.participant_id || "Anonymous"} · ${formatDate(session.started_at)}`; select.append(option);
    });
    $("#loginView").hidden = true; $("#dashboardView").hidden = false;
    if (state.sessions.length) { const selected = state.sessions.some((item) => item.session_id === state.sessionId) ? state.sessionId : state.sessions[0].session_id; select.value = selected; await loadSession(selected); }
  } catch (error) { if (error.status === 401 || error.status === 503) showLogin(error.status === 503 ? "Set TRACE_ADMIN_TOKEN before using this dashboard." : ""); else showLogin(error.message); }
}

$("#loginForm").addEventListener("submit", async (event) => { event.preventDefault(); try { await api("/api/admin/login", { method: "POST", body: JSON.stringify({ token: $("#adminToken").value }) }); $("#adminToken").value = ""; await loadSessions(); } catch (error) { $("#loginMessage").textContent = error.message; } });
$("#sessionSelect").addEventListener("change", (event) => loadSession(event.target.value));
$("#refreshButton").addEventListener("click", loadSessions);
$("#logoutButton").addEventListener("click", async () => { stop(); await api("/api/admin/logout", { method: "POST" }).catch(() => {}); showLogin("Logged out."); });
$("#previousButton").addEventListener("click", () => { stop(); show(state.index - 1); });
$("#nextButton").addEventListener("click", () => { stop(); show(state.index + 1); });
$("#scrubber").addEventListener("input", (event) => { stop(); show(Number(event.target.value)); });
$("#playButton").addEventListener("click", () => { if (state.timer) { stop(); return; } if (state.index >= state.events.length - 1) show(0); $("#playButton").textContent = "Pause"; state.timer = window.setInterval(() => { if (state.index >= state.events.length - 1) stop(); else show(state.index + 1); }, 700); });
documentFrame.addEventListener("load", () => {
  const pending = state.pendingReplay;
  if (pending) window.requestAnimationFrame(() => applyReplay(pending.event, pending.expectedIndex));
});

loadSessions();
