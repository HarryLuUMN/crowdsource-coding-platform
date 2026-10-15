"use strict";

// Load text, edit and reading helpers first. See docs/semantic-step-processing.md.

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
