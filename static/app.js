const queryParameters = new URLSearchParams(window.location.search);
const languageTasks = { knitscript: "stockinette-swatch-v1", "vega-lite": "vega-lite-sales-v1", idyll: "idyll-playground-v1", penrose: "penrose-playground-v1" };
const requestedTask = queryParameters.get("task");
const taskCatalog = window.DSL_TASK_CATALOG || {};
const pathLanguage = window.location.pathname.replace(/^\/|\/$/g, "");
const pathTaskSet = taskCatalog[pathLanguage];
const selectedTask = pathTaskSet?.tasks.find(task => task.id === requestedTask) || pathTaskSet?.tasks[0];
const TASK_ID = selectedTask?.id || (Object.values(languageTasks).includes(requestedTask) ? requestedTask : "stockinette-swatch-v1");
const language = pathTaskSet ? pathLanguage : Object.keys(languageTasks).find(key => languageTasks[key] === TASK_ID);
const runOnlyTask = !selectedTask && (language === "idyll" || language === "penrose");
let taskProgress = null;
let finalizationResult = null;
const isRuntimeTask = language === "idyll" || language === "penrose";
const isVegaTask = language === "vega-lite";
const languageSelect = document.querySelector("#languageSelect");
const taskSelect = document.querySelector("#taskSelect");
const localTaskSelection = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)
  || window.location.protocol === "file:";
const prolificRecruitment = {
  source: "prolific",
  prolific_pid: queryParameters.get("PROLIFIC_PID") || "",
  study_id: queryParameters.get("STUDY_ID") || "",
  prolific_session_id: queryParameters.get("SESSION_ID") || "",
};
const previewMode = queryParameters.get("preview") === "1";
let hasProlificParticipant = Boolean(prolificRecruitment.prolific_pid);
let participantId = hasProlificParticipant ? prolificRecruitment.prolific_pid : "";
let sourceStorageKey = "";
let practiceCompletionKey = "";
let telemetryStorageKey = "";
let currentStudyPhase = "practice";
const STARTER_SOURCE = "";
const TELEMETRY_BATCH_SIZE = 25;

const editor = document.querySelector("#sourceEditor");
const lineNumbers = document.querySelector("#lineNumbers");
const cursorPosition = document.querySelector("#cursorPosition");
const saveState = document.querySelector("#saveState");
const runButton = document.querySelector("#runButton");
const submitButton = document.querySelector("#submitButton");
const resetButton = document.querySelector("#resetButton");
const compilerState = document.querySelector("#compilerState");
const studyState = document.querySelector("#studyState");
const emptyState = document.querySelector("#emptyState");
const resultContent = document.querySelector("#resultContent");
const runSummary = document.querySelector("#runSummary");
const testOutput = document.querySelector("#testOutput");
const consoleOutput = document.querySelector("#consoleOutput");
const knitoutOutput = document.querySelector("#knitoutOutput");
const visualizationOutput = document.querySelector("#visualizationOutput");
const copyButton = document.querySelector("#copyButton");
const toast = document.querySelector("#toast");
const completionDialog = document.querySelector("#completionDialog");
const completionMessage = document.querySelector("#completionMessage");
const closeCompletionButton = document.querySelector("#closeCompletionButton");
const prolificCompletionLink = document.querySelector("#prolificCompletionLink");
const participantDialog = document.querySelector("#participantDialog");
const participantForm = document.querySelector("#participantForm");
const participantIdInput = document.querySelector("#participantIdInput");
const participantIdError = document.querySelector("#participantIdError");
const tabs = [...document.querySelectorAll(".tab")];
const workspace = document.querySelector(".workspace");
const taskResizer = document.querySelector("#taskResizer");
const consoleResizer = document.querySelector("#consoleResizer");
const columnResizer = document.querySelector("#columnResizer");
const guidePanel = document.querySelector(".guide-panel");
const resultPanel = document.querySelector(".result-panel");
const documentationFrame = document.querySelector("#documentationFrame");
const tutorialFrame = document.querySelector("#tutorialFrame");
const documentationViewTabs = [...document.querySelectorAll(".documentation-view-tab")];
const documentationTools = document.querySelector(".documentation-tools");
const documentationSearch = document.querySelector("#documentationSearch");
const documentationMatchCount = document.querySelector("#documentationMatchCount");
const documentationPreviousMatch = document.querySelector("#documentationPreviousMatch");
const documentationNextMatch = document.querySelector("#documentationNextMatch");
const documentationJumpTop = document.querySelector("#documentationJumpTop");
const taskPhaseBadge = document.querySelector("#taskPhaseBadge");
const taskDescription = document.querySelector("#taskDescription");
const fileName = document.querySelector("#fileName");
const editorLanguage = document.querySelector("#editorLanguage");
const knitoutTab = document.querySelector("#knitoutTab");
const visualizationTab = document.querySelector("#visualizationTab");
const emptyStateTitle = document.querySelector("#emptyStateTitle");
const emptyStateMessage = document.querySelector("#emptyStateMessage");

let activeTab = "knitout";
let saveTimer;
let toastTimer;
let previousSource = "";
let telemetrySessionId = null;
let telemetrySeq = 0;
let telemetryInitialSource = "";
let telemetryFlush = Promise.resolve();
let telemetryEnded = false;
let sessionReady = Promise.resolve();
let studyStarted = false;
let documentationMatches = [];
let activeDocumentationMatch = -1;
const pendingEvents = [];
let telemetryStartedAt = performance.now();
let onboardingActive = false;
let formalSessionReady = false;
let enteringFormal = false;
let replayingGuide = false;
const clientInstanceId = crypto.randomUUID();
const layoutStorageKey = "knitscript-studio-layout:v1";

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function currentLayout() {
  return {
    coding_width: Math.round(guidePanel.getBoundingClientRect().width),
    task_height: Math.round(guidePanel.getBoundingClientRect().height),
    console_height: Math.round(resultPanel.getBoundingClientRect().height),
  };
}

function applyLayout(layout) {
  if (!layout || window.innerWidth <= 900) return;
  const availableWidth = workspace.clientWidth - 5;
  const availableHeight = workspace.clientHeight - 10;
  const codingWidth = clamp(Number(layout.coding_width) || guidePanel.offsetWidth, 500, availableWidth - 300);
  const taskHeight = clamp(Number(layout.task_height) || guidePanel.offsetHeight, 120, availableHeight - 475);
  const consoleHeight = clamp(Number(layout.console_height) || resultPanel.offsetHeight, 140, availableHeight - taskHeight - 260);
  workspace.style.setProperty("--coding-column-size", `${codingWidth}px`);
  workspace.style.setProperty("--task-panel-size", `${taskHeight}px`);
  workspace.style.setProperty("--editor-panel-size", "minmax(260px, 1fr)");
  workspace.style.setProperty("--console-panel-size", `${consoleHeight}px`);
}

function saveLayout() {
  const layout = currentLayout();
  localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
  recordEvent("layout.resized", layout);
}

function resizeWithPointer(resizer, update) {
  resizer.addEventListener("pointerdown", (event) => {
    if (window.innerWidth <= 900) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLayout = currentLayout();
    resizer.classList.add("dragging");
    resizer.setPointerCapture(event.pointerId);
    const move = (moveEvent) => update(startLayout, moveEvent.clientX - startX, moveEvent.clientY - startY);
    const finish = () => {
      resizer.classList.remove("dragging");
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", finish);
      resizer.removeEventListener("pointercancel", finish);
      saveLayout();
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", finish);
    resizer.addEventListener("pointercancel", finish);
  });
}

function resizeWithKeyboard(resizer, axis, update) {
  resizer.addEventListener("keydown", (event) => {
    const delta = axis === "x"
      ? event.key === "ArrowLeft" ? -20 : event.key === "ArrowRight" ? 20 : 0
      : event.key === "ArrowUp" ? -20 : event.key === "ArrowDown" ? 20 : 0;
    if (!delta) return;
    event.preventDefault();
    update(currentLayout(), axis === "x" ? delta : 0, axis === "y" ? delta : 0);
    saveLayout();
  });
}

function initializeResizableLayout() {
  try {
    applyLayout(JSON.parse(localStorage.getItem(layoutStorageKey)));
  } catch (_error) {
    localStorage.removeItem(layoutStorageKey);
  }
  const resizeColumns = (layout, deltaX) => applyLayout({ ...layout, coding_width: layout.coding_width + deltaX });
  const resizeTask = (layout, _deltaX, deltaY) => applyLayout({ ...layout, task_height: layout.task_height + deltaY });
  const resizeConsole = (layout, _deltaX, deltaY) => applyLayout({ ...layout, console_height: layout.console_height - deltaY });
  resizeWithPointer(columnResizer, resizeColumns);
  resizeWithPointer(taskResizer, resizeTask);
  resizeWithPointer(consoleResizer, resizeConsole);
  resizeWithKeyboard(columnResizer, "x", resizeColumns);
  resizeWithKeyboard(taskResizer, "y", resizeTask);
  resizeWithKeyboard(consoleResizer, "y", resizeConsole);
}

function getPersistentId(key) {
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  localStorage.setItem(key, value);
  return value;
}

function persistTelemetryOutbox() {
  if (!telemetryStorageKey || telemetryEnded) return;
  try {
    localStorage.setItem(telemetryStorageKey, JSON.stringify({
      version: 1,
      task_id: TASK_ID,
      dsl: language,
      session_id: telemetrySessionId,
      seq: telemetrySeq,
      initial_source: telemetryInitialSource,
      pending_events: pendingEvents,
    }));
  } catch (_error) {
    showToast("Logging recovery storage is unavailable — keep this page open");
  }
}

function restoreTelemetryOutbox() {
  if (!telemetryStorageKey) return false;
  try {
    const saved = JSON.parse(localStorage.getItem(telemetryStorageKey));
    if (
      saved?.version !== 1
      || saved.task_id !== TASK_ID
      || (saved.session_id !== null && typeof saved.session_id !== "string")
      || !Array.isArray(saved.pending_events)
    ) return false;
    telemetrySessionId = saved.session_id;
    telemetrySeq = Number.isInteger(saved.seq) ? saved.seq : 0;
    telemetryInitialSource = typeof saved.initial_source === "string" ? saved.initial_source : editor.value;
    pendingEvents.splice(0, pendingEvents.length, ...saved.pending_events);
    return true;
  } catch (_error) {
    localStorage.removeItem(telemetryStorageKey);
    return false;
  }
}

function recordEvent(type, payload = {}) {
  if (!studyStarted || currentStudyPhase !== "formal" || telemetryEnded || onboardingActive || !formalSessionReady) return;
  telemetrySeq += 1;
  pendingEvents.push({
    client_event_id: `${clientInstanceId}:${telemetrySeq}`,
    seq: telemetrySeq,
    type,
    client_timestamp: new Date().toISOString(),
    elapsed_ms: Math.round(performance.now() - telemetryStartedAt),
    payload: { study_phase: currentStudyPhase, ...payload },
  });
  persistTelemetryOutbox();
  if (pendingEvents.length >= 50) void flushEvents();
}

function documentationEventPayload(extra = {}) {
  try {
    return { ...documentationReadingSnapshot(documentationFrame), ...extra };
  } catch (_error) {
    return extra;
  }
}

function clearDocumentationHighlights() {
  const doc = documentationFrame.contentDocument;
  if (!doc) return;
  doc.querySelectorAll("mark[data-documentation-search]").forEach((mark) => mark.replaceWith(doc.createTextNode(mark.textContent)));
  doc.body?.normalize();
  documentationMatches = [];
  activeDocumentationMatch = -1;
}

function updateDocumentationSearchControls() {
  const total = documentationMatches.length;
  documentationMatchCount.textContent = total ? `${activeDocumentationMatch + 1} / ${total}` : "0 / 0";
  documentationPreviousMatch.disabled = total === 0;
  documentationNextMatch.disabled = total === 0;
}

function showDocumentationMatch(index, direction = "current") {
  if (!documentationMatches.length) return;
  activeDocumentationMatch = (index + documentationMatches.length) % documentationMatches.length;
  documentationMatches.forEach((mark, matchIndex) => mark.classList.toggle("documentation-search-current", matchIndex === activeDocumentationMatch));
  const match = documentationMatches[activeDocumentationMatch];
  match.scrollIntoView({ block: "center", behavior: "smooth" });
  updateDocumentationSearchControls();
  recordEvent("guide.documentation_search_result_navigated", documentationEventPayload({
    query: documentationSearch.value.trim(),
    match_index: activeDocumentationMatch,
    match_count: documentationMatches.length,
    direction,
    matched_text: match.textContent,
  }));
}

function searchDocumentation() {
  clearDocumentationHighlights();
  const query = documentationSearch.value.trim();
  const doc = documentationFrame.contentDocument;
  if (!query || !doc?.body) {
    updateDocumentationSearchControls();
    recordEvent("guide.documentation_search_changed", documentationEventPayload({ query, match_count: 0 }));
    return;
  }
  const search = query.toLocaleLowerCase();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.textContent.trim() || node.parentElement?.closest("script,style,noscript,mark[data-documentation-search]")) return NodeFilter.FILTER_REJECT;
      return node.textContent.toLocaleLowerCase().includes(search) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    const text = node.textContent;
    const lower = text.toLocaleLowerCase();
    const fragment = doc.createDocumentFragment();
    let start = 0;
    let matchStart = lower.indexOf(search);
    while (matchStart !== -1) {
      fragment.append(doc.createTextNode(text.slice(start, matchStart)));
      const mark = doc.createElement("mark");
      mark.dataset.documentationSearch = "";
      mark.textContent = text.slice(matchStart, matchStart + query.length);
      fragment.append(mark);
      documentationMatches.push(mark);
      start = matchStart + query.length;
      matchStart = lower.indexOf(search, start);
    }
    fragment.append(doc.createTextNode(text.slice(start)));
    node.replaceWith(fragment);
  });
  if (documentationMatches.length) {
    if (!doc.querySelector("style[data-documentation-search-style]")) {
      const style = doc.createElement("style");
      style.dataset.documentationSearchStyle = "";
      style.textContent = "mark[data-documentation-search]{background:#596326;color:inherit;border-radius:2px;padding:0 1px}mark.documentation-search-current{background:#e5ff6f;color:#171910;box-shadow:0 0 0 2px rgba(229,255,111,.22)}";
      doc.head.append(style);
    }
    showDocumentationMatch(0, "search");
  } else {
    updateDocumentationSearchControls();
  }
  recordEvent("guide.documentation_search_changed", documentationEventPayload({ query, match_count: documentationMatches.length }));
}

function initializeDocumentationTools() {
  let searchTimer;
  documentationSearch.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(searchDocumentation, 180);
  });
  documentationSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    showDocumentationMatch(activeDocumentationMatch + (event.shiftKey ? -1 : 1), event.shiftKey ? "previous" : "next");
  });
  documentationPreviousMatch.addEventListener("click", () => showDocumentationMatch(activeDocumentationMatch - 1, "previous"));
  documentationNextMatch.addEventListener("click", () => showDocumentationMatch(activeDocumentationMatch + 1, "next"));
  documentationJumpTop.addEventListener("click", () => {
    documentationFrame.contentWindow?.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    recordEvent("guide.documentation_jumped_to_top", documentationEventPayload());
  });
  documentationFrame.addEventListener("load", () => {
    clearDocumentationHighlights();
    updateDocumentationSearchControls();
    if (documentationSearch.value.trim()) searchDocumentation();
  });
}

function selectDocumentationView(name, logInteraction = false) {
  const tutorialSelected = name === "tutorial";
  documentationFrame.hidden = tutorialSelected;
  tutorialFrame.hidden = !tutorialSelected;
  documentationTools.hidden = tutorialSelected;
  documentationViewTabs.forEach((tab) => {
    const selected = tab.dataset.documentationView === name;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  if (logInteraction) {
    const frame = tutorialSelected ? tutorialFrame : documentationFrame;
    recordEvent("guide.view_tab_selected", { view: name, ...documentationReadingSnapshot(frame) });
  }
}

async function createTelemetrySession(initialSource, eventType, eventPayload = {}) {
  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participant_id: participantId,
        task_id: TASK_ID,
        dsl: language,
        initial_source: initialSource,
        recruitment: hasProlificParticipant ? prolificRecruitment : { source: "direct" },
        client: {
          programming_language: language,
          client_instance_id: clientInstanceId,
          locale: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        },
      }),
    });
    if (!response.ok) return false;
    const body = await response.json();
    telemetrySessionId = body.session.session_id;
    telemetryInitialSource = initialSource;
    persistTelemetryOutbox();
    recordEvent(eventType, { source_length: initialSource.length, ...eventPayload });
    return true;
  } catch (_error) {
    return false;
  }
}

async function initializeTelemetrySession() {
  const restored = restoreTelemetryOutbox();
  if (restored && telemetrySessionId) {
    recordEvent("session.resumed", { source_length: editor.value.length, pending_event_count: pendingEvents.length });
    return true;
  }
  const initialSource = restored ? telemetryInitialSource : editor.value;
  return createTelemetrySession(initialSource, restored ? "session.connected" : "session.started", {
    queued_event_count: pendingEvents.length,
  });
}

async function recoverMissingTelemetrySession() {
  const missingSessionId = telemetrySessionId;
  const droppedEventCount = pendingEvents.length;
  telemetrySessionId = null;
  telemetrySeq = 0;
  telemetryInitialSource = editor.value;
  pendingEvents.splice(0);
  localStorage.removeItem(telemetryStorageKey);
  return createTelemetrySession(editor.value, "session.recovered", {
    missing_session_id: missingSessionId,
    recovered_from_source_checkpoint: true,
    dropped_event_count: droppedEventCount,
  });
}

async function flushEvents() {
  if (!studyStarted || currentStudyPhase !== "formal" || onboardingActive || !formalSessionReady || telemetryEnded) return false;
  telemetryFlush = telemetryFlush.catch(() => false).then(async () => {
    await sessionReady;
    if (!telemetrySessionId) {
      const connected = await createTelemetrySession(
        telemetryInitialSource,
        "session.connected",
        { queued_event_count: pendingEvents.length },
      );
      if (!connected) return false;
    }
    while (pendingEvents.length > 0) {
      const events = pendingEvents.slice(0, TELEMETRY_BATCH_SIZE);
      const batchId = crypto.randomUUID();
      try {
        const response = await fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: telemetrySessionId, batch_id: batchId, events }),
        });
        if (response.status === 400 || response.status === 404) {
          await response.text();
          if (await recoverMissingTelemetrySession()) continue;
          return false;
        }
        if (!response.ok) throw new Error("Telemetry upload failed");
        await response.text();
        pendingEvents.splice(0, events.length);
        persistTelemetryOutbox();
      } catch (_error) {
        persistTelemetryOutbox();
        return false;
      }
    }
    return true;
  });
  return telemetryFlush;
}

function eventBatchesFor(events) {
  const batches = [];
  for (let index = 0; index < events.length; index += TELEMETRY_BATCH_SIZE) {
    batches.push({
      batch_id: crypto.randomUUID(),
      events: events.slice(index, index + TELEMETRY_BATCH_SIZE),
    });
  }
  return batches;
}

function sendPendingEventsWithBeacon() {
  if (!telemetrySessionId) return;
  persistTelemetryOutbox();
  eventBatchesFor(pendingEvents).forEach((batch) => {
    const payload = JSON.stringify({ session_id: telemetrySessionId, ...batch });
    navigator.sendBeacon("/api/events", new Blob([payload], { type: "application/json" }));
  });
}

async function finishTelemetrySession() {
  if (!telemetrySessionId || telemetryEnded) return telemetryEnded;
  recordEvent("session.ended", { source_length: editor.value.length });
  if (!await flushEvents()) return false;
  try {
    const response = await fetch("/api/sessions/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: telemetrySessionId, final_source: editor.value }),
    });
    if (!response.ok) return false;
    finalizationResult = await response.json();
  } catch (_error) {
    return false;
  }
  telemetryEnded = true;
  localStorage.removeItem(telemetryStorageKey);
  localStorage.removeItem(sourceStorageKey);
  return true;
}

function describeEdit(before, after, inputType = "") {
  let start = 0;
  const shorterLength = Math.min(before.length, after.length);
  while (start < shorterLength && before[start] === after[start]) start += 1;

  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const insertedText = after.slice(start, afterEnd);
  const deletedText = before.slice(start, beforeEnd);
  let operation = "replace";
  if (!deletedText) operation = "insert";
  if (!insertedText) operation = "delete";

  return {
    operation,
    origin: inputType || "unknown",
    offset_encoding: "utf-16",
    range_start: start,
    range_end: beforeEnd,
    inserted_text: insertedText,
    deleted_text: deletedText,
    source_length_after: after.length,
  };
}

function eventTypeForInput(inputType = "") {
  if (inputType === "insertFromPaste") return "editor.paste";
  if (inputType === "historyUndo") return "editor.undo";
  if (inputType === "historyRedo") return "editor.redo";
  return "editor.edit";
}

function hasResumableFormalSession() {
  if (!telemetryStorageKey) return false;
  try {
    const saved = JSON.parse(localStorage.getItem(telemetryStorageKey));
    return saved?.version === 1
      && saved.task_id === TASK_ID
      && typeof saved.session_id === "string"
      && saved.session_id.length > 0;
  } catch (_error) {
    return false;
  }
}

function setInitialSource() {
  const savedSource = localStorage.getItem(sourceStorageKey);
  const canRestore = currentStudyPhase === "practice" || hasResumableFormalSession();
  if (!canRestore && savedSource !== null) localStorage.removeItem(sourceStorageKey);
  editor.value = canRestore ? (savedSource || STARTER_SOURCE) : STARTER_SOURCE;
  updateEditorChrome();
}

function clearResult() {
  emptyState.hidden = false;
  resultContent.hidden = true;
  runSummary.innerHTML = "";
  testOutput.innerHTML = "";
  consoleOutput.textContent = "";
  knitoutOutput.textContent = "";
  visualizationOutput.innerHTML = "";
}

function setStudyPhase(phase, sourceStorageScope) {
  currentStudyPhase = phase;
  const practice = phase === "practice";
  document.querySelector("#howItWorksButton").hidden = practice || !pathTaskSet;
  document.querySelector(".task-selectors").hidden = practice;
  languageSelect.value = language;
  taskSelect.replaceChildren(...(pathTaskSet ? pathTaskSet.tasks.map(task => {
    const state = taskProgress?.tasks.find(item => item.id === task.id);
    const option = new Option(`${task.label}${state?.completed ? " — Completed" : state && !state.unlocked ? " — Locked" : ""}`, task.id, false, task.id === TASK_ID);
    option.disabled = Boolean(state && (state.completed || !state.unlocked));
    return option;
  }) : [new Option("Task 01", TASK_ID)]));
  const progressBar = document.querySelector("#taskProgress");
  progressBar.hidden = !pathTaskSet;
  document.querySelector("#taskDropdown").hidden = Boolean(pathTaskSet);
  progressBar.replaceChildren(...(pathTaskSet ? pathTaskSet.tasks.map((task, index) => {
    const state = taskProgress?.tasks.find(item => item.id === task.id);
    const status = state?.completed ? "passed" : task.id === taskProgress?.current_task_id ? "current" : "locked";
    const step = document.createElement("li");
    step.className = `task-step ${status}`;
    step.title = `${task.label} — ${status === "passed" ? "Passed" : status === "current" ? "Current task" : "Locked"}`;
    step.setAttribute("aria-label", `Level ${index + 1}: ${status}`);
    if (status === "current") step.setAttribute("aria-current", "step");
    const dot = document.createElement("span");
    dot.className = "task-step-dot";
    dot.setAttribute("aria-hidden", "true");
    dot.textContent = status === "passed" ? "✓" : "";
    const label = document.createElement("span");
    label.textContent = `Level ${index + 1}`;
    step.append(dot, label);
    return step;
  }) : []));
  sourceStorageKey = practice
    ? `coding-platform-practice-source:v1:${sourceStorageScope}`
    : `knitscript-studio-source:${TASK_ID}:from-scratch-v1:${sourceStorageScope}`;
  taskPhaseBadge.hidden = !practice;
  taskDescription.textContent = practice
    ? "This short practice task is only for learning how to use the coding platform. It is not part of the formal study, and the formal task may use a different programming language. Write a Python program that prints exactly: Hello, coding platform! Use Run to check your program, then Submit to continue to the formal task."
    : "Write a KnitScript program that produces a 10-stitch-wide stockinette swatch on the front bed. The swatch should begin with a secure cast-on, transition cleanly into the main fabric, and contain six complete stockinette rows. Keep the fabric within the intended width and avoid operations that alter its basic structure. Run your code to evaluate the result, then submit when all tests pass.";
  fileName.textContent = practice ? "practice.py" : "swatch.ks";
  editorLanguage.textContent = practice ? "Python" : "KnitScript";
  editor.setAttribute("aria-label", practice ? "Python practice source code" : "KnitScript source code");
  knitoutTab.hidden = practice;
  visualizationTab.hidden = practice;
  if (!practice && isVegaTask) {
    taskDescription.textContent = "Write a Vega-Lite JSON specification from scratch for an interactive monthly sales trend chart. Use the supplied dataset at /sales-data.json, with fields month (date), category (product group), and sales (number). Show a separate colored line for each category, with month on the horizontal axis and sales on the vertical axis. On hover, show the month, category, and sales. Clicking a category in the legend should highlight it and fade the others. Include a clear chart title and explicit axis titles. Use a single-view chart and the original records without transforms, aggregation, binning, or time-unit conversion. Run to preview the chart and check the requirements; submit when all tests pass.";
    fileName.textContent = "sales.vl.json";
    editorLanguage.textContent = "Vega-Lite";
    editor.setAttribute("aria-label", "Vega-Lite JSON specification");
    documentationFrame.title = "Vega-Lite documentation";
    tutorialFrame.title = "Visualization background tutorial";
    documentationFrame.src = "/documentation/vega-lite/docs/";
    tutorialFrame.src = "/vega-guide.html";
  }
  if (!practice && isRuntimeTask) {
    const name = language === "idyll" ? "Idyll" : "Penrose";
    taskDescription.textContent = language === "idyll"
      ? "Write an Idyll article from scratch. Run to compile and preview interactive components, variables, and expressions. This runtime preview does not yet include study task checks."
      : "Write a Penrose Substance program from scratch using Set and Point objects and the supplied relationships. Run to compile and lay out the diagram with the fixed Domain and Style. This runtime preview does not yet include study task checks.";
    fileName.textContent = language === "idyll" ? "article.idyll" : "diagram.substance";
    editorLanguage.textContent = name;
    editor.setAttribute("aria-label", `${name} source code`);
    documentationFrame.title = `${name} runtime guide`;
    tutorialFrame.title = `${name} runtime guide`;
    documentationFrame.src = `/dsl-guide.html#${language}`;
    tutorialFrame.src = `/dsl-guide.html#${language}`;
  }
  if (!practice && selectedTask) taskDescription.textContent = selectedTask.description;
  submitButton.hidden = !practice && runOnlyTask;
  knitoutTab.textContent = !practice && isRuntimeTask ? "Compiled output" : !practice && isVegaTask ? "Specification" : "Knitout";
  emptyStateTitle.textContent = practice ? "Run your practice program" : "Run your code against the task";
  emptyStateMessage.textContent = practice
    ? "Use Run to check the output, then Submit when the practice test passes."
    : "You will see a result for each requirement here before submitting.";
  setInitialSource();
  if (!practice) telemetryInitialSource = editor.value;
  previousSource = editor.value;
  clearResult();
  selectTab(practice ? "tests" : "knitout");
}

function updateLineNumbers() {
  const lines = editor.value.split("\n").length;
  lineNumbers.textContent = Array.from({ length: lines }, (_, index) => index + 1).join("\n");
}

function updateCursorPosition() {
  const beforeCursor = editor.value.slice(0, editor.selectionStart);
  const line = beforeCursor.split("\n").length;
  const lastBreak = beforeCursor.lastIndexOf("\n");
  const column = editor.selectionStart - lastBreak;
  cursorPosition.textContent = `Ln ${line}, Col ${column}`;
}

function updateEditorChrome() {
  updateLineNumbers();
  updateCursorPosition();
}

function persistSource() {
  saveState.textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(sourceStorageKey, editor.value);
    saveState.textContent = "Saved locally";
  }, 350);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 1800);
}

function clearToast() {
  clearTimeout(toastTimer);
  toast.classList.remove("visible");
  toast.textContent = "";
}

function selectTab(name, logInteraction = false) {
  activeTab = name;
  tabs.forEach((tab) => {
    const selected = tab.dataset.tab === name;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  testOutput.hidden = name !== "tests";
  consoleOutput.hidden = name !== "console";
  knitoutOutput.hidden = name !== "knitout";
  visualizationOutput.hidden = name !== "visualization";
  copyButton.hidden = name !== "knitout" || !knitoutOutput.textContent;
  if (logInteraction) recordEvent(`output.${name}_viewed`);
}

function renderCheck(check) {
  if (!check || !Array.isArray(check.tests)) {
    testOutput.innerHTML = "";
    return;
  }
  testOutput.innerHTML = check.tests
    .map(
      (test) => `
        <article class="test-case ${test.passed ? "passed" : "failed"}">
          <span class="test-marker" aria-hidden="true">${test.passed ? "✓" : "×"}</span>
          <div>
            <h3>${escapeHtml(test.label)}</h3>
            <p>${escapeHtml(test.message)}</p>
          </div>
        </article>`,
    )
    .join("");
}

function showResult(result) {
  emptyState.hidden = true;
  resultContent.hidden = false;
  const check = runOnlyTask ? null : result.check;
  const checkPill = check
    ? `<span class="summary-pill ${check.passed ? "success" : "error"}">${check.passed_count}/${check.total_count} tests passed</span>`
    : "";

  if (isRuntimeTask) {
    runSummary.textContent = result.ok ? "Compiled — preview below" : `${editorLanguage.textContent} execution failed`;
    consoleOutput.textContent = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join("\n");
    knitoutOutput.textContent = result.svg || (result.ast ? JSON.stringify(result.ast, null, 2) : "");
    visualizationOutput.replaceChildren();
    if (result.ok) {
      const frame = document.createElement("iframe");
      frame.title = `${editorLanguage.textContent} preview`;
      frame.setAttribute("sandbox", "allow-scripts");
      if (language === "idyll") {
        frame.src = "/idyll-preview.html";
        frame.addEventListener("load", () => frame.contentWindow.postMessage({ type: "idyll.render", ast: result.ast }, "*"));
      } else {
        frame.setAttribute("sandbox", "");
        frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">${result.svg}`;
      }
      visualizationOutput.append(frame);
    }
    renderCheck(check);
    selectTab(result.ok ? (check && !check.passed ? "tests" : "visualization") : "console");
    return;
  }

  if (isVegaTask) {
    runSummary.textContent = result.ok ? (runOnlyTask ? "Compiled — preview below" : `${check?.passed_count || 0}/${check?.total_count || 0} checks passed`) : "Vega-Lite evaluation failed";
    consoleOutput.textContent = result.error?.message || result.stdout || "";
    knitoutOutput.textContent = result.spec ? JSON.stringify(result.spec, null, 2) : "";
    visualizationOutput.replaceChildren();
    if (result.ok && result.spec) {
      const frame = document.createElement("iframe");
      frame.title = "Interactive Vega-Lite chart";
      frame.src = "/vega-preview.html";
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      frame.addEventListener("load", () => frame.contentWindow.postMessage({ type: "vega.render", spec: result.spec }, window.location.origin));
      visualizationOutput.append(frame);
    }
    renderCheck(check);
    selectTab(result.ok ? (check && !check.passed ? "tests" : "visualization") : "console");
    return;
  }

  if (result.ok) {
    const metrics = result.metrics || {};
    runSummary.innerHTML = [
      `<span class="summary-pill success">✓ Compiled</span>`,
      checkPill,
      `<span class="summary-pill">${result.duration_ms ?? 0} ms</span>`,
      `<span class="summary-pill">${metrics.loops ?? 0} loops</span>`,
      `<span class="summary-pill">${metrics.stitches ?? 0} stitches</span>`,
      `<span class="summary-pill">${metrics.courses ?? 0} courses</span>`,
    ].join("");
    const messages = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    consoleOutput.textContent = messages || "Compilation completed without messages.";
    consoleOutput.classList.remove("error");
    knitoutOutput.textContent = result.knitout || "";
    KnitoutVisualizer.render(visualizationOutput, result.knitout || "", metrics);
  } else {
    const error = result.error || {};
    runSummary.innerHTML = [
      `<span class="summary-pill error">× Compile failed</span>`,
      checkPill,
      result.duration_ms == null ? "" : `<span class="summary-pill">${result.duration_ms} ms</span>`,
      error.type ? `<span class="summary-pill">${escapeHtml(error.type)}</span>` : "",
    ].join("");
    consoleOutput.textContent = [error.message, result.stdout, result.stderr, result.details]
      .filter(Boolean)
      .join("\n\n");
    consoleOutput.classList.add("error");
    knitoutOutput.textContent = "";
    KnitoutVisualizer.render(visualizationOutput, result.partial_knitout || "", result.metrics || {});
  }
  renderCheck(check);
  selectTab(result.ok ? "knitout" : "console");
}

function showPracticeResult(result) {
  emptyState.hidden = true;
  resultContent.hidden = false;
  runSummary.innerHTML = `<span class="summary-pill ${result.passed ? "success" : "error"}">${result.passed ? "✓ Practice check passed" : "× Practice check needs revision"}</span>`;
  renderCheck({
    tests: [{
      passed: result.passed,
      label: "Print the requested message",
      message: result.message,
    }],
  });
  consoleOutput.textContent = result.passed ? result.output : "No output yet.";
  consoleOutput.classList.toggle("error", !result.passed);
  selectTab("tests");
}

async function executePractice(mode) {
  clearToast();
  const isSubmission = mode === "submit";
  const activeButton = isSubmission ? submitButton : runButton;
  runButton.disabled = true;
  submitButton.disabled = true;
  activeButton.querySelector("span").textContent = isSubmission ? "Submitting…" : "Running…";
  try {
    const result = PracticeTask.check(editor.value);
    showPracticeResult(result);
    if (isSubmission && result.passed) {
      localStorage.setItem(practiceCompletionKey, "completed");
      const sourceStorageScope = prolificRecruitment.prolific_session_id || participantId;
      setStudyPhase("formal", sourceStorageScope);
      activeButton.querySelector("span").textContent = "Submit";
      await beginFormalTask("practice_completed");
    } else if (isSubmission) {
      showToast("Complete the practice task before continuing");
    }
  } finally {
    setStudyControlsEnabled(!taskProgress?.completed);
    activeButton.querySelector("span").textContent = isSubmission ? "Submit" : "Run";
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showCompletion(result) {
  const completionUrl = result.completion_url;
  prolificCompletionLink.hidden = !completionUrl;
  if (completionUrl) {
    prolificCompletionLink.href = completionUrl;
    completionMessage.textContent = "Your solution and programming trace are saved. Return to Prolific to finish the study.";
    closeCompletionButton.textContent = "Stay here";
  } else {
    prolificCompletionLink.removeAttribute("href");
    completionMessage.textContent = "Your solution and programming trace are saved. This preview has no Prolific completion URL configured yet.";
    closeCompletionButton.textContent = "Close";
  }
  completionDialog.showModal();
}

async function executeSource(mode, trigger = "button") {
  if (runButton.disabled || submitButton.disabled) return;
  if (currentStudyPhase === "practice") return executePractice(mode);
  clearToast();
  const isSubmission = mode === "submit";
  if (isSubmission && runOnlyTask) return;
  const submittedSource = editor.value;
  if (isSubmission) {
    editor.disabled = true;
    resetButton.disabled = true;
    taskSelect.disabled = true;
  }
  const activeButton = isSubmission ? submitButton : runButton;
  runButton.disabled = true;
  submitButton.disabled = true;
  activeButton.querySelector("span").textContent = isSubmission ? "Submitting…" : "Running…";
  compilerState.innerHTML = `<i></i> ${isSubmission ? "Checking submission" : "Running tests"}`;
  try {
    await sessionReady;
    recordEvent(`${mode}.requested`, { trigger, source_length: submittedSource.length });
    if (!await flushEvents()) throw new Error("Your trace could not be saved. Please retry.");
    const response = await fetch(isSubmission ? "/api/submit" : "/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: submittedSource, session_id: telemetrySessionId, task_id: TASK_ID, dsl: language }),
    });
    const result = await response.json();
    showResult(result);
    if (result.trace_saved === false) showToast("Compiled, but the trace could not be saved");
    const eventOutcome = isSubmission && result.submission?.passed ? "accepted" : result.ok ? "completed" : "failed";
    recordEvent(`${mode}.${eventOutcome}`, {
      execution_id: result.execution_id || null,
      code_state_id: result.code_state_id || null,
      submission_id: result.submission?.submission_id || null,
      duration_ms: result.duration_ms ?? null,
      error_type: result.error?.type || null,
      metrics: result.metrics || null,
      check: result.check || null,
    });
    await flushEvents();
    if (isSubmission && result.submission?.passed) {
      const traceFinalized = await finishTelemetrySession();
      if (!traceFinalized) {
        showToast("Submission passed, but saving is incomplete. Please retry Submit before continuing.");
      } else if (selectedTask && finalizationResult?.progress) {
        taskProgress = finalizationResult.progress;
        if (!taskProgress.current_task_id) {
          document.querySelectorAll("#taskProgress .task-step").forEach(step => {
            step.className = "task-step passed";
            step.removeAttribute("aria-current");
            step.setAttribute("aria-label", `${step.lastElementChild.textContent}: passed`);
            step.title = `${step.lastElementChild.textContent} — Passed`;
            step.firstElementChild.textContent = "✓";
          });
        }
        if (taskProgress.current_task_id) {
          const destination = new URL(window.location.href);
          destination.searchParams.set("task", taskProgress.current_task_id);
          window.location.assign(destination.href);
        } else {
          showCompletion({ ...result, completion_url: finalizationResult.completion_url });
          document.querySelector("#completionTitle").textContent = "All three tasks completed";
        }
      } else {
        showCompletion(result);
      }
    }
    if (isSubmission && result.submission && !result.submission.passed) showToast("Not accepted yet — review the failed tests");
  } catch (error) {
    showResult({ ok: false, error: { type: "ConnectionError", message: error.message || "Could not reach the compiler backend." } });
    recordEvent(`${mode}.connection_error`);
  } finally {
    setStudyControlsEnabled(!taskProgress?.completed);
    activeButton.querySelector("span").textContent = isSubmission ? "Submit" : "Run";
    compilerState.innerHTML = "<i></i> Compiler ready";
  }
}

editor.addEventListener("input", (event) => {
  const currentSource = editor.value;
  recordEvent(eventTypeForInput(event.inputType), describeEdit(previousSource, currentSource, event.inputType));
  previousSource = currentSource;
  updateEditorChrome();
  persistSource();
});
editor.addEventListener("click", updateCursorPosition);
editor.addEventListener("keyup", updateCursorPosition);
editor.addEventListener("scroll", () => {
  lineNumbers.scrollTop = editor.scrollTop;
});
editor.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    editor.setRangeText("  ", start, end, "end");
    editor.dispatchEvent(new Event("input"));
  }
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    executeSource("run", "shortcut");
  }
});

runButton.addEventListener("click", () => executeSource("run", "button"));
submitButton.addEventListener("click", () => executeSource("submit", "button"));
resetButton.addEventListener("click", () => {
  const previousLength = editor.value.length;
  editor.value = STARTER_SOURCE;
  previousSource = STARTER_SOURCE;
  localStorage.setItem(sourceStorageKey, STARTER_SOURCE);
  updateEditorChrome();
  recordEvent("file.reset", {
    previous_length: previousLength,
    source_length_after: STARTER_SOURCE.length,
    source_after: STARTER_SOURCE,
  });
  showToast("Editor cleared");
  editor.focus();
});
copyButton.addEventListener("click", async () => {
  await navigator.clipboard.writeText(knitoutOutput.textContent);
  recordEvent("output.knitout_copied", { character_count: knitoutOutput.textContent.length });
  showToast("Knitout copied");
});
tabs.forEach((tab) => tab.addEventListener("click", () => selectTab(tab.dataset.tab, true)));
initializeDocumentationTools();
documentationViewTabs.forEach((tab) => tab.addEventListener("click", () => selectDocumentationView(tab.dataset.documentationView, true)));
const recordDocumentationView = attachDocumentationReading(documentationFrame, recordEvent);
const recordTutorialView = attachDocumentationReading(tutorialFrame, recordEvent);
closeCompletionButton.addEventListener("click", () => completionDialog.close());
prolificCompletionLink.addEventListener("click", async (event) => {
  const completionUrl = prolificCompletionLink.href;
  if (!completionUrl) return;
  event.preventDefault();
  prolificCompletionLink.setAttribute("aria-disabled", "true");
  prolificCompletionLink.textContent = "Saving trace…";
  if (await finishTelemetrySession()) {
    window.location.assign(completionUrl);
    return;
  }
  prolificCompletionLink.removeAttribute("aria-disabled");
  prolificCompletionLink.textContent = "Return to Prolific";
  showToast("Your trace is still saving — try again in a moment");
});

document.addEventListener("visibilitychange", () => {
  recordEvent(document.hidden ? "page.hidden" : "page.visible");
  if (document.hidden) void flushEvents();
});

window.addEventListener("pagehide", () => {
  recordDocumentationView();
  recordTutorialView();
  if (!telemetrySessionId || telemetryEnded) return;
  persistTelemetryOutbox();
  sendPendingEventsWithBeacon();
});

window.addEventListener("pageshow", () => void flushEvents());
window.addEventListener("online", () => void flushEvents());

fetch("/api/health")
  .then((response) => {
    if (!response.ok) throw new Error("offline");
  })
  .catch(() => {
    compilerState.classList.add("offline");
    compilerState.innerHTML = "<i></i> Compiler offline";
  });

function setStudyControlsEnabled(enabled) {
  enabled = enabled && !onboardingActive && (currentStudyPhase === "practice" || formalSessionReady);
  languageSelect.disabled = !enabled || Boolean(pathTaskSet) || !localTaskSelection;
  taskSelect.disabled = !enabled || (!pathTaskSet && !localTaskSelection);
  editor.disabled = !enabled;
  runButton.disabled = !enabled;
  submitButton.disabled = !enabled;
  resetButton.disabled = !enabled;
}

async function startStudy(identityMethod) {
  if (studyStarted) return;
  if (!participantId) participantId = getPersistentId("knitscript-participant-id");
  const sourceStorageScope = prolificRecruitment.prolific_session_id || participantId;
  practiceCompletionKey = `coding-platform-practice-complete:v1:${sourceStorageScope}`;
  telemetryStorageKey = `knitscript-telemetry-outbox:${TASK_ID}:${sourceStorageScope}`;
  studyStarted = true;
  if (pathTaskSet) {
    setStudyControlsEnabled(false);
    studyState.textContent = "Loading task progress…";
    try {
      const response = await fetch("/api/progress", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participant_id: participantId, dsl: language, recruitment: hasProlificParticipant ? prolificRecruitment : { source: "direct" } }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error?.message || "Progress unavailable");
      taskProgress = body.progress;
      if (taskProgress.completed) {
        setStudyPhase("formal", sourceStorageScope);
        setStudyControlsEnabled(false);
        studyState.textContent = "All tasks completed";
        showCompletion({ completion_url: body.completion_url });
        document.querySelector("#completionTitle").textContent = "All three tasks completed";
        return;
      }
      if (taskProgress.current_task_id !== TASK_ID) {
        const destination = new URL(window.location.href);
        destination.searchParams.set("task", taskProgress.current_task_id);
        window.location.replace(destination.href);
        return;
      }
    } catch (error) {
      studyState.textContent = "Could not load task progress";
      showToast("Could not load saved progress. Please reload to retry.");
      return;
    }
  }
  setStudyControlsEnabled(true);
  studyState.textContent = hasProlificParticipant ? "Prolific session" : "Preview mode";
  setStudyPhase(localStorage.getItem(practiceCompletionKey) === "completed" ? "formal" : "practice", sourceStorageScope);
  if (currentStudyPhase === "formal") {
    await beginFormalTask("page_opened");
    if (identityMethod === "manual") recordEvent("participant.id_provided", { method: identityMethod });
  }
}

function onboardingStorageKey() {
  return `coding-platform-onboarding:v1:${language}:${participantId}:${prolificRecruitment.study_id}:${prolificRecruitment.prolific_session_id}`;
}

async function beginFormalTask(transition) {
  if (enteringFormal || formalSessionReady || taskProgress?.completed) return;
  enteringFormal = true;
  const notice = document.querySelector("#onboardingNotice");
  try {
    let seen = false;
    try { seen = localStorage.getItem(onboardingStorageKey()) === "completed"; } catch (_) {}
    const firstTask = pathTaskSet?.tasks[0].id === TASK_ID;
    if (pathTaskSet && firstTask && !seen) {
      onboardingActive = true;
      setStudyControlsEnabled(false);
      notice.hidden = true;
      const completed = await window.StudioOnboarding?.start({ required: true });
      onboardingActive = false;
      if (!completed) {
        notice.hidden = false;
        return;
      }
      try { localStorage.setItem(onboardingStorageKey(), "completed"); } catch (_) {}
    }
    notice.hidden = true;
    telemetryStartedAt = performance.now();
    formalSessionReady = true;
    sessionReady = initializeTelemetrySession();
    await sessionReady;
    recordEvent("formal_task.started", { transition });
    await flushEvents();
    setStudyControlsEnabled(true);
    editor.focus();
  } catch (_) {
    onboardingActive = false;
    notice.hidden = false;
    showToast("Could not start the task. Please retry the guide.");
  } finally {
    enteringFormal = false;
  }
}

document.querySelector("#onboardingRetryButton").addEventListener("click", () => beginFormalTask("guide_retried"));
document.querySelector("#howItWorksButton").addEventListener("click", async () => {
  if (onboardingActive || enteringFormal || replayingGuide) return;
  if (!formalSessionReady && !taskProgress?.completed) return beginFormalTask("guide_reopened");
  if (runButton.disabled && !taskProgress?.completed) return;
  if (!window.StudioOnboarding) {
    showToast("The guide could not load. Please reload to retry.");
    return;
  }
  replayingGuide = true;
  await flushEvents();
  const pausedAt = performance.now();
  onboardingActive = true;
  setStudyControlsEnabled(false);
  try { await window.StudioOnboarding.start({ required: false }); }
  finally {
    telemetryStartedAt += performance.now() - pausedAt;
    onboardingActive = false;
    replayingGuide = false;
    setStudyControlsEnabled(!taskProgress?.completed);
  }
});

languageSelect.addEventListener("change", async () => {
  if (!localTaskSelection || pathTaskSet) return;
  if (runButton.disabled || submitButton.disabled) {
    languageSelect.value = language;
    return;
  }
  setStudyControlsEnabled(false);
  clearTimeout(saveTimer);
  localStorage.setItem(sourceStorageKey, editor.value);
  try {
    await sessionReady;
    await flushEvents();
  } finally {
    const destination = new URL(window.location.href);
    destination.pathname = `/${languageSelect.value}`;
    destination.searchParams.delete("task");
    window.location.assign(destination.href);
  }
});

taskSelect.addEventListener("change", async () => {
  if (!pathTaskSet || currentStudyPhase !== "formal") return;
  const nextTask = taskSelect.value;
  if (nextTask !== taskProgress?.current_task_id || !pathTaskSet.tasks.some(task => task.id === nextTask) || runButton.disabled) {
    taskSelect.value = TASK_ID;
    return;
  }
  setStudyControlsEnabled(false);
  clearTimeout(saveTimer);
  localStorage.setItem(sourceStorageKey, editor.value);
  try {
    await sessionReady;
    if (!await flushEvents()) throw new Error("Task events have not been saved");
    const destination = new URL(window.location.href);
    destination.searchParams.set("task", nextTask);
    window.location.assign(destination.href);
  } catch (error) {
    setStudyControlsEnabled(true);
    taskSelect.value = TASK_ID;
    showToast("Could not save the current task. Please retry before switching.");
  }
});

window.addEventListener("message", event => {
  const frame = visualizationOutput.querySelector("iframe");
  if (!frame || event.source !== frame.contentWindow) return;
  if (language === "idyll" && event.origin === "null" && event.data?.type === "idyll.render_error") {
    consoleOutput.textContent = String(event.data.message || "Idyll preview failed");
    runSummary.textContent = "Idyll preview failed";
    recordEvent("output.render_failed", { language, message: consoleOutput.textContent });
    selectTab("console");
    return;
  }
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === "vega.interaction") recordEvent("output.visualization_interacted", { interaction: event.data.interaction });
  if (event.data?.type === "vega.render_error") {
    showToast("Chart preview failed — see Console");
    consoleOutput.textContent = event.data.message;
    recordEvent("output.visualization_failed", { message: event.data.message });
  }
});

participantForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const suppliedId = participantIdInput.value.trim();
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(suppliedId)) {
    participantIdError.textContent = "Enter a valid Prolific participant ID.";
    participantIdInput.focus();
    return;
  }
  prolificRecruitment.source = "prolific_manual";
  prolificRecruitment.prolific_pid = suppliedId;
  hasProlificParticipant = true;
  participantId = suppliedId;
  queryParameters.set("PROLIFIC_PID", suppliedId);
  history.replaceState(null, "", `${window.location.pathname}?${queryParameters.toString()}`);
  participantDialog.close();
  startStudy("manual");
  editor.focus();
});

participantIdInput.addEventListener("input", () => {
  participantIdError.textContent = "";
});

participantDialog.addEventListener("cancel", (event) => event.preventDefault());

initializeResizableLayout();
window.addEventListener("resize", () => {
  try {
    applyLayout(JSON.parse(localStorage.getItem(layoutStorageKey)));
  } catch (_error) {
    localStorage.removeItem(layoutStorageKey);
  }
});

if (hasProlificParticipant) {
  startStudy("url");
} else if (previewMode) {
  startStudy("preview");
} else {
  setStudyControlsEnabled(false);
  studyState.textContent = "Participant ID required";
  participantDialog.showModal();
  participantIdInput.focus();
}
setInterval(() => void flushEvents(), 2000);
