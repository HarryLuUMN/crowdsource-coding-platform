"use strict";

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
