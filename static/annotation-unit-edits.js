"use strict";

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

// Advance the replay cursor; an existing synthetic brace needs no new step.
function applyEditPiece(cursor, piece, action, opensFrame, finalSource) {
  const { source, offset } = cursor;
  if (action === "insert" && piece.trim() === "}" && cursor.frames > 0) {
    cursor.source = source.slice(0, offset) + piece.slice(0, piece.lastIndexOf("}")) + source.slice(offset);
    cursor.offset += piece.length;
    cursor.frames--;
    return false;
  }
  if (action === "insert") {
    cursor.source = source.slice(0, offset) + piece + (opensFrame ? "}" : "") + source.slice(offset);
    cursor.offset += piece.length;
    if (opensFrame) cursor.frames++;
  } else if (action === "delete") {
    cursor.source = source.slice(0, offset) + source.slice(offset + piece.length);
  } else {
    cursor.source = finalSource;
  }
  return true;
}

// Keep labels attached to their original events, even after splitting a paste.
function createEditStep(episode, dataset, index, transition) {
  const { first, last, group, change, action, pieces } = episode;
  const { previousSource, source, piece, opensFrame } = transition;
  const text = piece.trim();
  const type = classifyEditUnit(action, change, text, opensFrame);
  return {
    ...last, index, event: "editor.edit_group", previousSource, source,
    changed: previousSource !== source, unitType: type, action,
    sourceSteps: [...new Set(group.flatMap(s => s.sourceSteps || []))],
    rawStepIndices: group.map(s => s.index), rawSteps: group,
    synthetic: pieces.length > 1, elapsedStartMs: first.elapsedMs,
    note: `${action} ${type}: ${text || "whitespace"}${pieces.length > 1 ? " · decomposed edit; intermediate state inferred" : ""}`,
    annotationProvenance: group.flatMap(s => (dataset.annotations?.[s.index] || []).map(code => ({
      code, rawStep: s.index, sourceSteps: s.sourceSteps, ambiguous: pieces.length > 1,
    }))),
  };
}

function appendRevertedEdit(steps, group) {
  const first = group[0], last = group[group.length - 1];
  steps.push({
    ...last, index: steps.length, event: "editor.edit_group", changed: false,
    previousSource: first.previousSource, unitType: "reverted_edit", action: "replace",
    rawStepIndices: group.map(s => s.index), sourceSteps: group.flatMap(s => s.sourceSteps || []), rawSteps: group,
    note: "Local editing returned to the original source; original events retained.",
  });
}

// Preserve the observed final source if decomposition leaves a remainder.
function appendEditRemainder(steps, group) {
  const first = group[0], last = group[group.length - 1];
  if (steps[steps.length - 1]?.source === last.source) return;
  steps.push({
    ...last, index: steps.length, event: "editor.edit_group",
    previousSource: steps[steps.length - 1]?.source || first.previousSource, source: last.source,
    unitType: "incomplete_unit", action: "replace", sourceSteps: group.flatMap(s => s.sourceSteps || []),
    rawStepIndices: group.map(s => s.index), rawSteps: group, synthetic: true,
    note: "Unresolved structural remainder; inspect original events.",
  });
}

// Plan the net edit, replay each piece, then verify the final source.
function appendEditUnits(steps, group, dataset) {
  const first = group[0], last = group[group.length - 1];
  const change = unitChange(first.previousSource || "", last.source || "");
  if (!change.removed && !change.inserted) {
    appendRevertedEdit(steps, group);
    return;
  }
  let action = "replace";
  if (!change.removed) action = "insert";
  else if (!change.inserted) action = "delete";
  const pieces = action === "replace" ? [change.inserted] : unitSegments(change.inserted || change.removed);
  const episode = { first, last, group, change, action, pieces };
  const cursor = { source: first.previousSource || "", offset: change.start, frames: 0 };
  pieces.forEach((piece, part) => {
    const previousSource = cursor.source;
    const hasClosingBrace = pieces.slice(part + 1).some(p => p.trim() === "}");
    const opensFrame = action === "insert" && piece.trim().endsWith("{") && hasClosingBrace;
    if (!applyEditPiece(cursor, piece, action, opensFrame, last.source)) return;
    steps.push(createEditStep(episode, dataset, steps.length, {
      previousSource, source: cursor.source, piece, opensFrame,
    }));
  });
  appendEditRemainder(steps, group);
}
