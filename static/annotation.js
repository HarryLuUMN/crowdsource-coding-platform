"use strict";

const $ = (selector) => document.querySelector(selector);
const state = { dataset: null, codes: [], selectedStep: 0, annotations: {}, activeTab: "code" };
const STORAGE_PREFIX = "trace-annotations:";
const TRACE_CATALOG = [
  { key: "s4", id: "443bbe19-51d6-431e-bd0f-55baecdcc183", participant: "6638e8aa3d1f38846080806a", steps: 57, unit: "semantic steps" },
  { key: "67aa5", id: "b8c98aac-ad68-4c62-8a4f-aaf0dbbc3f21", participant: "67aa54c162dc637de018fe18", steps: 646, unit: "events" },
  { key: "65fda", id: "053e926a-ff9f-4c4a-8868-14f331800b21", participant: "65fda4aa45ba55e983e2a2d9", steps: 865, unit: "events" },
];
let loadingTrace = false;
let matrixZoom = 1;
let fitMatrix = false;

function setMatrixZoom(value, fit = false) {
  matrixZoom = Math.max(0.05, Math.min(2, value));
  fitMatrix = fit;
  $("#annotationMatrix").style.zoom = matrixZoom;
  $("#zoomValue").textContent = `${Math.round(matrixZoom * 100)}%`;
  $("#zoomOutButton").disabled = matrixZoom <= 0.05;
  $("#zoomInButton").disabled = matrixZoom >= 2;
  $("#fitGridButton").setAttribute("aria-pressed", String(fit));
}

function fitAllSteps() {
  const shell = $("#matrixShell");
  const table = $("#annotationMatrix");
  if (!shell.clientWidth || !shell.clientHeight) return;
  setMatrixZoom(1, true);
  const bounds = table.getBoundingClientRect();
  setMatrixZoom(Math.min(1, (shell.clientWidth - 4) / bounds.width, (shell.clientHeight - 4) / bounds.height), true);
  shell.scrollTo(0, 0);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({ ok: false, error: { message: `Request failed (${response.status}).` } }));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function storageKey() {
  return `${STORAGE_PREFIX}${state.dataset.trace.id}`;
}

function loadAnnotations() {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey()) || "{}");
    state.annotations = stored.annotations && typeof stored.annotations === "object" ? stored.annotations : structuredClone(state.dataset.annotations || {});
  } catch {
    state.annotations = structuredClone(state.dataset.annotations || {});
  }
}

function saveAnnotations() {
  localStorage.setItem(storageKey(), JSON.stringify({
    schemaVersion: 1,
    traceId: state.dataset.trace.id,
    participant: state.dataset.trace.participant,
    updatedAt: new Date().toISOString(),
    annotations: state.annotations,
  }));
  $("#saveState").textContent = "Saved locally";
  updateProgress();
}

function selectedCodes(stepIndex) {
  return Array.isArray(state.annotations[stepIndex]) ? state.annotations[stepIndex] : [];
}

function visibleCodebook() {
  return state.dataset.codebook.filter((group) => group.group !== "KnitScript challenges");
}

function updateProgress() {
  const total = state.dataset.steps.length;
  const visibleIds = new Set(state.codes.map((code) => code.id));
  const complete = Object.values(state.annotations).filter((codes) => Array.isArray(codes) && codes.some((id) => visibleIds.has(id))).length;
  $("#progressText").textContent = `${complete} / ${total} steps annotated`;
  $("#progressBar").style.width = `${total ? (complete / total) * 100 : 0}%`;
}

function elapsed(ms) {
  const seconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function eventName(value) {
  if (value === "editor.edit_group") return "Code edit";
  if (value === "run.requested") return "Run";
  if (value.startsWith("guide.")) return "Reading";
  return value.replaceAll("_", " ").replaceAll(".", " · ");
}

function renderTrace() {
  const trace = state.dataset.trace;
  const entry = TRACE_CATALOG.find((item) => item.id === trace.id);
  if (entry) entry.steps = trace.stepCount;
  renderTraceList();
  $("#traceTask").textContent = trace.task;
  $("#dataNote").textContent = trace.dataNote;
  $("#traceStatus").textContent = trace.status || "Passed";
}

function renderTraceList() {
  const list = $("#traceList");
  list.replaceChildren();
  const query = $("#traceSearch").value.trim().toLowerCase();
  TRACE_CATALOG.filter((item) => `${item.participant} ${item.id}`.includes(query)).forEach((item) => {
    const button = document.createElement("button");
    const selected = item.id === state.dataset?.trace.id;
    button.className = `trace-card${selected ? " active" : ""}`;
    button.type = "button";
    button.disabled = loadingTrace;
    button.setAttribute("aria-pressed", String(selected));
    const dot = document.createElement("span"); dot.className = "status-dot";
    const title = document.createElement("strong"); title.textContent = `Trace ${item.participant.slice(0, 5)}`;
    const participant = document.createElement("small"); participant.textContent = item.participant; participant.title = item.participant;
    const stats = document.createElement("span"); stats.className = "trace-stats"; stats.textContent = `${item.steps} ${item.unit} · Annotated`;
    button.append(dot, title, participant, stats);
    button.addEventListener("click", () => { if (!selected) loadDataset(item.key); });
    list.append(button);
  });
  if (!list.childElementCount) { const empty = document.createElement("p"); empty.className = "data-note"; empty.textContent = "No matching annotated traces."; list.append(empty); }
}

function renderLegend() {
  const colors = ["#79b8ff", "#ffcc66", "#bf8cff"];
  const legend = $("#codebookLegend");
  legend.replaceChildren();
  visibleCodebook().forEach((group, index) => {
    const item = document.createElement("span");
    item.style.setProperty("--group-color", colors[index]);
    item.textContent = `${group.group} · ${group.codes.length}`;
    legend.append(item);
  });
}

function renderMatrix() {
  const head = $("#matrixHead");
  const body = $("#matrixBody");
  head.replaceChildren();
  body.replaceChildren();
  const row = document.createElement("tr");
  const stepHead = document.createElement("th");
  stepHead.className = "step-head";
  stepHead.textContent = "Step";
  const evidenceHead = document.createElement("th");
  evidenceHead.className = "evidence-head";
  evidenceHead.textContent = "Observed action";
  row.append(stepHead, evidenceHead);
  state.codes.forEach((code) => {
    const th = document.createElement("th");
    th.className = `code-head group-${code.groupIndex}`;
    th.title = `${code.label}\n\n${code.description}`;
    const label = document.createElement("span");
    label.textContent = code.short;
    th.append(label);
    row.append(th);
  });
  head.append(row);

  state.dataset.steps.forEach((step) => {
    const tr = document.createElement("tr");
    tr.dataset.step = step.index;
    tr.dataset.search = `${step.index} ${step.event} ${step.note}`.toLowerCase();
    const number = document.createElement("th");
    number.scope = "row";
    number.textContent = String(step.index + 1).padStart(2, "0");
    const evidence = document.createElement("td");
    evidence.className = "evidence";
    evidence.title = step.note;
    const kind = document.createElement("span");
    kind.className = "event-mini";
    kind.textContent = eventName(step.event);
    evidence.append(kind, document.createTextNode(step.note));
    tr.append(number, evidence);
    state.codes.forEach((code) => {
      const td = document.createElement("td");
      td.className = "code-cell";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cell-button";
      button.dataset.code = code.id;
      button.title = `${code.label}: ${code.description}`;
      button.setAttribute("aria-label", `${code.label} for step ${step.index + 1}`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleCode(step.index, code.id);
      });
      td.append(button);
      tr.append(td);
    });
    tr.addEventListener("click", () => selectStep(step.index));
    body.append(tr);
  });
  refreshMatrix();
}

function refreshMatrix() {
  [...$("#matrixBody").rows].forEach((row) => {
    const stepIndex = Number(row.dataset.step);
    row.classList.toggle("current", stepIndex === state.selectedStep);
    const applied = new Set(selectedCodes(stepIndex));
    row.querySelectorAll(".cell-button").forEach((button) => {
      const selected = applied.has(button.dataset.code);
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  });
}

function toggleCode(stepIndex, codeId) {
  const selected = new Set(selectedCodes(stepIndex));
  if (selected.has(codeId)) selected.delete(codeId);
  else selected.add(codeId);
  state.annotations[stepIndex] = [...selected];
  state.selectedStep = stepIndex;
  saveAnnotations();
  refreshMatrix();
  renderDetail();
}

function lineDiff(before, after) {
  if (before === after) return [{ type: "same", number: "", text: "No source change in this semantic step." }];
  const a = before.split("\n");
  const b = after.split("\n");
  const lengths = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) lengths[i][j] = a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { lines.push({ type: "same", number: j + 1, text: `  ${b[j]}` }); i += 1; j += 1; }
    else if (j < b.length && (i === a.length || lengths[i][j + 1] >= lengths[i + 1][j])) { lines.push({ type: "add", number: j + 1, text: `+ ${b[j]}` }); j += 1; }
    else { lines.push({ type: "remove", number: i + 1, text: `- ${a[i]}` }); i += 1; }
  }
  return lines;
}

function renderDiff(step) {
  const container = $("#codeDiff");
  container.replaceChildren();
  lineDiff(step.previousSource || "", step.source || "").forEach((line) => {
    const element = document.createElement("div");
    element.className = `diff-line ${line.type}`;
    const number = document.createElement("b");
    number.textContent = line.number;
    const text = document.createElement("span");
    text.textContent = line.text;
    element.append(number, text);
    container.append(element);
  });
}

function renderReading(step) {
  const container = $("#readingEvidence");
  container.replaceChildren();
  if (!step.reading) {
    const empty = document.createElement("div");
    empty.className = "no-reading";
    empty.innerHTML = "<div><strong>No reading event at this step</strong><span>The trace records code or execution activity here.</span></div>";
    container.append(empty);
    return;
  }
  const card = document.createElement("article");
  card.className = "reading-card";
  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = step.reading.title;
  const location = document.createElement("span");
  location.textContent = step.reading.location;
  header.append(title, location);
  const paper = document.createElement("div");
  paper.className = "reading-paper";
  const mark = document.createElement("mark");
  mark.textContent = step.reading.excerpt;
  paper.append(mark);
  const precision = document.createElement("p");
  precision.className = "precision-note";
  precision.textContent = step.reading.precision;
  card.append(header, paper, precision);
  container.append(card);
}

function renderAppliedCodes(stepIndex) {
  const container = $("#appliedCodes");
  container.replaceChildren();
  const ids = selectedCodes(stepIndex).filter((id) => state.codes.some((code) => code.id === id));
  if (!ids.length) {
    const empty = document.createElement("span");
    empty.className = "code-pill empty";
    empty.textContent = "No codes applied";
    container.append(empty);
    return;
  }
  ids.forEach((id) => {
    const code = state.codes.find((item) => item.id === id);
    const pill = document.createElement("span");
    pill.className = "code-pill";
    pill.textContent = code?.label || id;
    pill.title = code?.description || "";
    container.append(pill);
  });
}

function renderDetail() {
  const step = state.dataset.steps[state.selectedStep];
  $("#stepTitle").textContent = `Step ${step.index + 1} of ${state.dataset.steps.length}`;
  $("#stepTime").textContent = elapsed(step.elapsedMs);
  $("#eventChip").textContent = eventName(step.event);
  $("#stepNote").textContent = step.note;
  const code = $("#codeSnapshot code");
  code.textContent = step.source || "No code has been written at this step.";
  code.classList.toggle("empty-code", !step.source);
  renderDiff(step);
  renderReading(step);
  renderAppliedCodes(step.index);
}

function selectStep(index) {
  state.selectedStep = Math.max(0, Math.min(state.dataset.steps.length - 1, index));
  refreshMatrix();
  renderDetail();
}

function setDetailTab(name) {
  state.activeTab = name;
  document.querySelectorAll("[data-detail-tab]").forEach((button) => button.classList.toggle("active", button.dataset.detailTab === name));
  document.querySelectorAll(".detail-view").forEach((view) => view.classList.toggle("active", view.id === `${name}View`));
}

function exportAnnotations() {
  const payload = {
    schemaVersion: 1,
    trace: state.dataset.trace,
    codebookVersion: "behavioral-properties-2026-10-02",
    exportedAt: new Date().toISOString(),
    annotations: state.dataset.steps.map((step) => ({ step: step.index, codes: selectedCodes(step.index) })),
  };
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  anchor.download = `annotations-${state.dataset.trace.label.replaceAll(" ", "-").toLowerCase()}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

async function importAnnotations(file) {
  const payload = JSON.parse(await file.text());
  if (payload.trace?.id !== state.dataset.trace.id || !Array.isArray(payload.annotations)) throw new Error("This file does not contain annotations for the selected trace.");
  const validCodes = new Set(state.dataset.codebook.flatMap((group) => group.codes.map((code) => code.id)));
  state.annotations = {};
  payload.annotations.forEach((entry) => {
    if (!Number.isInteger(entry.step) || !Array.isArray(entry.codes)) return;
    state.annotations[entry.step] = entry.codes.filter((code) => validCodes.has(code));
  });
  saveAnnotations();
  refreshMatrix();
  renderDetail();
}

function bindInteractions() {
  $("#traceSearch").addEventListener("input", renderTraceList);
  $("#stepFilter").addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    [...$("#matrixBody").rows].forEach((row) => row.classList.toggle("filtered", query && !row.dataset.search.includes(query)));
    if (fitMatrix) fitAllSteps();
  });
  $("#zoomOutButton").addEventListener("click", () => setMatrixZoom(matrixZoom / 1.2));
  $("#zoomInButton").addEventListener("click", () => setMatrixZoom(matrixZoom * 1.2));
  $("#fitGridButton").addEventListener("click", fitAllSteps);
  $("#resetZoomButton").addEventListener("click", () => setMatrixZoom(1));
  new ResizeObserver(() => { if (fitMatrix) fitAllSteps(); }).observe($("#matrixShell"));
  $("#clearStepButton").addEventListener("click", () => {
    state.annotations[state.selectedStep] = [];
    saveAnnotations(); refreshMatrix(); renderDetail();
  });
  document.querySelectorAll("[data-detail-tab]").forEach((button) => button.addEventListener("click", () => setDetailTab(button.dataset.detailTab)));
  $("#exportButton").addEventListener("click", exportAnnotations);
  $("#importButton").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async (event) => {
    try { if (event.target.files[0]) await importAnnotations(event.target.files[0]); }
    catch (error) { window.alert(error.message); }
    event.target.value = "";
  });
  $("#logoutButton").addEventListener("click", async () => {
    try { await api("/api/admin/logout", { method: "POST" }); } catch {}
    showLogin("");
  });
}

function showLogin(message = "") {
  $("#appView").hidden = true;
  $("#loginView").hidden = false;
  $("#loginMessage").textContent = message;
}

async function loadDataset(traceName = new URLSearchParams(location.search).get("trace") || "s4") {
  if (loadingTrace) return;
  loadingTrace = true;
  if (state.dataset) { saveAnnotations(); renderTraceList(); }
  try {
    const payload = await api("/api/admin/annotation-dataset/s4");
    let dataset = payload.dataset;
    if (["67aa5", "65fda"].includes(traceName)) {
      const review = await api(`/api/admin/annotation-review/${traceName}`);
      const [detail, stream, initial] = await Promise.all([
        api(`/api/admin/sessions/${review.session}`),
        api(`/api/admin/sessions/${review.session}/events?limit=10000`),
        api(`/api/admin/sessions/${review.session}/file?path=code/source-initial.ks`),
      ]);
      dataset = buildSessionDataset(detail, stream.events, payload.dataset.codebook, initial.content || "", review.review);
      if (review.outcome) dataset.trace.dataNote += ` ${review.outcome}`;
    }
    state.dataset = dataset;
    state.selectedStep = 0;
    $("#stepFilter").value = "";
    const url = new URL(location.href); url.searchParams.set("trace", traceName); history.replaceState(null, "", url);
    state.codes = visibleCodebook().flatMap((group, groupIndex) => group.codes.map((code) => ({ ...code, group: group.group, groupIndex })));
    loadAnnotations();
    renderTrace(); renderLegend(); renderMatrix(); renderDetail(); updateProgress();
    $("#loginView").hidden = true;
    $("#appView").hidden = false;
  } catch (error) {
    if (error.status === 401 || error.status === 503) showLogin(error.status === 503 ? "Set TRACE_ADMIN_TOKEN before using this studio." : "");
    else showLogin(error.message);
  } finally {
    loadingTrace = false;
    if (state.dataset) renderTraceList();
  }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/admin/login", { method: "POST", body: JSON.stringify({ token: $("#adminToken").value }) });
    $("#adminToken").value = "";
    await loadDataset();
  } catch (error) {
    $("#loginMessage").textContent = error.message;
  }
});

bindInteractions();
loadDataset();
