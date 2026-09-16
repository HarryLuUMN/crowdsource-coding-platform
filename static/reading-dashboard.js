"use strict";

const $ = (selector) => document.querySelector(selector);
const state = { sessions: [], events: [], index: 0, timer: null, sessionId: null };

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
  const viewport = $("#viewport");
  viewport.replaceChildren();
  if (!blocks.length) {
    const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "No visible text was captured for this event."; viewport.append(empty);
  }
  blocks.forEach((block) => {
    const article = document.createElement("article");
    article.className = `text-block${block.partially_visible ? " partial" : ""}`;
    const meta = document.createElement("div");
    const tag = document.createElement("span"); tag.textContent = block.tag || "text";
    const section = document.createElement("span"); section.textContent = block.section || "Document navigation";
    meta.append(tag, section);
    const text = document.createElement("pre"); text.textContent = block.text || "";
    article.append(meta, text); viewport.append(article);
  });
  const maxScroll = Math.max(1, Number(payload.document_height || 1) - Number(payload.viewport_height || 0));
  $("#scrollThumb").style.top = `${Math.min(97, Math.max(1, Number(payload.scroll_y || 0) / maxScroll * 96))}%`;
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
  else { $("#viewport").innerHTML = '<p class="empty">This session has no reading events.</p>'; $("#counter").textContent = "0 / 0"; }
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

loadSessions();
