"use strict";

function unitChange(before, after) {
  let start = 0, a = before.length, b = after.length;
  while (start < a && start < b && before[start] === after[start]) start++;
  while (a > start && b > start && before[a - 1] === after[b - 1]) { a--; b--; }
  return { start, end: a, removed: before.slice(start, a), inserted: after.slice(start, b) };
}

function unitSegments(text) {
  const segments = [];
  let start = 0, quote = "", escape = false, comment = false, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (comment) { if (c === "\n") comment = false; else continue; }
    if (quote) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "#") { comment = true; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth === 0 && [";", "{", "}"].includes(c)) {
      segments.push(text.slice(start, i + 1)); start = i + 1;
    }
  }
  if (start < text.length) segments.push(text.slice(start));
  return segments;
}

function buildUnitDataset(dataset, { mergeReading = true } = {}) {
  const rawSteps = dataset.steps;
  const steps = [];
  let pending = [];
  function emit(group) {
    const first = group[0], last = group[group.length - 1];
    const change = unitChange(first.previousSource || "", last.source || "");
    if (!change.removed && !change.inserted) {
      steps.push({ ...last, index: steps.length, event: "editor.edit_group", changed: false,
        previousSource: first.previousSource, unitType: "reverted_edit", action: "replace",
        rawStepIndices: group.map(s => s.index), sourceSteps: group.flatMap(s => s.sourceSteps || []), rawSteps: group,
        note: "Local editing returned to the original source; original events retained." });
      return;
    }
    const action = !change.removed ? "insert" : !change.inserted ? "delete" : "replace";
    const pieces = action === "replace" ? [change.inserted] : unitSegments(change.inserted || change.removed);
    let source = first.previousSource || "", offset = change.start;
    let frames = 0;
    pieces.forEach((piece, part) => {
      if (action === "insert" && piece.trim() === "}" && frames > 0) {
        source = source.slice(0, offset) + piece.slice(0, piece.lastIndexOf("}")) + source.slice(offset);
        offset += piece.length; frames--; return;
      }
      const previousSource = source;
      const opensFrame = action === "insert" && piece.trim().endsWith("{") && pieces.slice(part + 1).some(p => p.trim() === "}");
      if (action === "insert") { source = source.slice(0, offset) + piece + (opensFrame ? "}" : "") + source.slice(offset); offset += piece.length; if (opensFrame) frames++; }
      else if (action === "delete") source = source.slice(0, offset) + source.slice(offset + piece.length);
      else source = last.source;
      const text = piece.trim();
      const type = action === "replace" ? unitSegments(change.removed).length > 1 || unitSegments(change.inserted).length > 1 ? "unresolved_compound_edit" : "small_span" : opensFrame ? "empty_frame" : text.endsWith("{") || text === "}" ? "frame_boundary" : text.endsWith(";") ? /^(?:global\s+)?\w+\s*=/.test(text) ? "assignment" : "operation" : "incomplete_unit";
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
      steps.push({ ...last, index: steps.length, event: "editor.edit_group", previousSource: steps[steps.length - 1]?.source || first.previousSource, source: last.source,
        unitType: "incomplete_unit", action: "replace", sourceSteps: group.flatMap(s => s.sourceSteps || []),
        rawStepIndices: group.map(s => s.index), rawSteps: group, synthetic: true, note: "Unresolved structural remainder; inspect original events." });
    }
  }
  function flush() { if (pending.length) emit(pending); pending = []; }
  rawSteps.forEach(step => {
    if (mergeReading && step.reading) {
      flush();
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
      return;
    }
    if (!step.event.startsWith("editor.") || !step.changed) {
      flush(); steps.push({ ...step, index: steps.length, rawStepIndices: [step.index], rawSteps: [step] }); return;
    }
    const change = unitChange(step.previousSource || "", step.source || "");
    const previous = pending[pending.length - 1];
    if (previous) {
      const prior = unitChange(previous.previousSource || "", previous.source || "");
      if (step.event !== "editor.edit" || step.elapsedMs - previous.elapsedMs > 5000 ||
          change.start < prior.start || change.start > prior.start + prior.inserted.length + 1 ||
          unitSegments(prior.inserted).some(s => /[;{}]$/.test(s))) flush();
    }
    pending.push(step);
    if (step.event !== "editor.edit" || unitSegments(change.inserted || change.removed).length > 1) flush();
  });
  flush();
  const annotations = {};
  steps.forEach(step => {
    const codes = [...new Set(step.rawStepIndices.flatMap(index => dataset.annotations?.[index] || []))];
    if (codes.length) annotations[step.index] = codes;
  });
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
