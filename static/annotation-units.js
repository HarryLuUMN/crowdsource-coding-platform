"use strict";

// Method and limitations: docs/semantic-step-processing.md.

// Find the smallest enclosing text range that changed.
function unitChange(before, after) {
  let start = 0;
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (start < beforeEnd && start < afterEnd && before[start] === after[start]) start++;
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--;
    afterEnd--;
  }
  return {
    start,
    end: beforeEnd,
    removed: before.slice(start, beforeEnd),
    inserted: after.slice(start, afterEnd),
  };
}

// Split on outer delimiters, not delimiters inside strings or brackets.
function unitSegments(text) {
  const segments = [];
  let start = 0, quote = "", escape = false, comment = false, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (comment) {
      if (c === "\n") comment = false;
      else continue;
    }
    if (quote) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === quote) quote = "";
      continue;
    }
    // Legacy comment handling is retained for output compatibility.
    if (c === "#") {
      comment = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth === 0 && [";", "{", "}"].includes(c)) {
      segments.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) segments.push(text.slice(start));
  return segments;
}

// Replacement is conservative: multi-piece changes stay unresolved.
function classifyEditUnit(action, change, text, opensFrame) {
  if (action === "replace") {
    const replacesMultiplePieces = unitSegments(change.removed).length > 1 ||
      unitSegments(change.inserted).length > 1;
    return replacesMultiplePieces ? "unresolved_compound_edit" : "small_span";
  }
  if (opensFrame) return "empty_frame";
  if (text.endsWith("{") || text === "}") return "frame_boundary";
  if (!text.endsWith(";")) return "incomplete_unit";
  return /^(?:global\s+)?\w+\s*=/.test(text) ? "assignment" : "operation";
}

// Time, edit location and completed boundaries limit each typing group.
function startsNewEditGroup(previous, step) {
  if (step.event !== "editor.edit") return true;
  if (step.elapsedMs - previous.elapsedMs > 5000) return true;
  const prior = unitChange(previous.previousSource || "", previous.source || "");
  const current = unitChange(step.previousSource || "", step.source || "");
  if (current.start < prior.start) return true;
  if (current.start > prior.start + prior.inserted.length + 1) return true;
  return unitSegments(prior.inserted).some(piece => /[;{}]$/.test(piece));
}

// Convert one edit group into units while retaining its raw evidence.
function appendEditUnits(steps, group, dataset) {
  const first = group[0], last = group[group.length - 1];
  const change = unitChange(first.previousSource || "", last.source || "");
  if (!change.removed && !change.inserted) {
    steps.push({ ...last, index: steps.length, event: "editor.edit_group", changed: false,
      previousSource: first.previousSource, unitType: "reverted_edit", action: "replace",
      rawStepIndices: group.map(s => s.index), sourceSteps: group.flatMap(s => s.sourceSteps || []), rawSteps: group,
      note: "Local editing returned to the original source; original events retained." });
    return;
  }
  let action = "replace";
  if (!change.removed) action = "insert";
  else if (!change.inserted) action = "delete";
  const pieces = action === "replace" ? [change.inserted] : unitSegments(change.inserted || change.removed);
  let source = first.previousSource || "", offset = change.start;
  let frames = 0;
  pieces.forEach((piece, part) => {
    if (action === "insert" && piece.trim() === "}" && frames > 0) {
      // The frame already has a synthetic closing brace; keep only its layout.
      source = source.slice(0, offset) + piece.slice(0, piece.lastIndexOf("}")) + source.slice(offset);
      offset += piece.length;
      frames--;
      return;
    }
    const previousSource = source;
    const hasLaterClosingBrace = pieces.slice(part + 1).some(p => p.trim() === "}");
    const opensFrame = action === "insert" && piece.trim().endsWith("{") && hasLaterClosingBrace;
    // A pasted frame is synthetic; this is not an observed typing order.
    if (action === "insert") {
      source = source.slice(0, offset) + piece + (opensFrame ? "}" : "") + source.slice(offset);
      offset += piece.length;
      if (opensFrame) frames++;
    } else if (action === "delete") {
      source = source.slice(0, offset) + source.slice(offset + piece.length);
    } else {
      source = last.source;
    }
    const text = piece.trim();
    const type = classifyEditUnit(action, change, text, opensFrame);
    steps.push({ ...last, index: steps.length, event: "editor.edit_group", previousSource, source,
      changed: previousSource !== source, unitType: type, action,
      sourceSteps: [...new Set(group.flatMap(s => s.sourceSteps || []))],
      rawStepIndices: group.map(s => s.index), rawSteps: group,
      synthetic: pieces.length > 1, elapsedStartMs: first.elapsedMs,
      note: `${action} ${type}: ${text || "whitespace"}${pieces.length > 1 ? " · decomposed edit; intermediate state inferred" : ""}`,
      annotationProvenance: group.flatMap(s => (dataset.annotations?.[s.index] || []).map(code => ({ code, rawStep: s.index, sourceSteps: s.sourceSteps, ambiguous: pieces.length > 1 }))),
    });
  });
  if (steps[steps.length - 1]?.source !== last.source) {
    // Never lose the actual final source when decomposition is incomplete.
    steps.push({ ...last, index: steps.length, event: "editor.edit_group", previousSource: steps[steps.length - 1]?.source || first.previousSource, source: last.source,
      unitType: "incomplete_unit", action: "replace", sourceSteps: group.flatMap(s => s.sourceSteps || []),
      rawStepIndices: group.map(s => s.index), rawSteps: group, synthetic: true, note: "Unresolved structural remainder; inspect original events." });
  }
}

// Merge adjacent reading evidence; a non-reading event ends the sequence.
function appendReadingSequence(steps, step, dataset) {
  const previous = steps[steps.length - 1];
  const group = previous?.unitType === "reading_sequence" ? [...previous.rawSteps, step] : [step];
  const first = group[0];
  const combined = { ...step, index: previous?.unitType === "reading_sequence" ? previous.index : steps.length,
    event: "reading.sequence", unitType: "reading_sequence", previousSource: first.previousSource,
    elapsedStartMs: first.elapsedMs, elapsedEndMs: step.elapsedMs,
    rawStepIndices: group.map(s => s.index), rawSteps: group,
    sourceSteps: [...new Set(group.flatMap(s => s.sourceSteps || []))],
    annotationProvenance: group.flatMap(s => (dataset.annotations?.[s.index] || []).map(code => ({ code, rawStep: s.index, sourceSteps: s.sourceSteps }))),
    note: `Continuous reading sequence · ${group.length} original events`,
    reading: { title: [...new Set(group.map(s => s.reading.title))].join(" → "),
      location: `${first.reading.location} → ${step.reading.location}`,
      excerpt: [...new Set(group.map(s => s.reading.excerpt).filter(Boolean))].join("\n\n"),
      precision: step.reading.precision },
  };
  if (previous?.unitType === "reading_sequence") steps[steps.length - 1] = combined;
  else steps.push(combined);
}

// Group events, build units, then carry labels through raw-event links.
function buildUnitDataset(dataset, { mergeReading = true } = {}) {
  const rawSteps = dataset.steps;
  const steps = [];
  let pending = [];
  function flush() {
    if (pending.length) appendEditUnits(steps, pending, dataset);
    pending = [];
  }
  rawSteps.forEach(step => {
    if (mergeReading && step.reading) {
      flush();
      appendReadingSequence(steps, step, dataset);
      return;
    }
    if (!step.event.startsWith("editor.") || !step.changed) {
      flush();
      steps.push({ ...step, index: steps.length, rawStepIndices: [step.index], rawSteps: [step] });
      return;
    }
    const previous = pending[pending.length - 1];
    if (previous && startsNewEditGroup(previous, step)) flush();
    const change = unitChange(step.previousSource || "", step.source || "");
    pending.push(step);
    if (step.event !== "editor.edit" || unitSegments(change.inserted || change.removed).length > 1) flush();
  });
  flush();
  const annotations = mapRawAnnotations({ steps }, dataset.annotations || {});
  return { ...dataset, granularity: mergeReading ? "syntactic-unit-v2" : "syntactic-unit-v1", rawSteps, rawAnnotations: dataset.annotations || {}, steps, annotations,
    trace: { ...dataset.trace, stepCount: steps.length, rawStepCount: rawSteps.length,
      dataNote: `${steps.length} units/events derived from ${rawSteps.length} original steps. Raw evidence retained; decomposed edits have inferred intermediate states and shared annotation provenance.` } };
}

function mapRawAnnotations(dataset, annotations) {
  const mapped = {};
  dataset.steps.forEach(step => {
    const codes = [...new Set((step.rawStepIndices || [step.index]).flatMap(index => annotations[index] || []))];
    if (codes.length) mapped[step.index] = codes;
  });
  return mapped;
}
