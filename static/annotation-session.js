"use strict";

function buildSessionDataset(detail, events, codebook, initialSource = "", review = {}) {
  let source = initialSource;
  const steps = events.map((event, index) => {
    const p = event.payload || {};
    const previousSource = source;
    if (event.type.startsWith("editor.")) {
      if (typeof p.source_after === "string") source = p.source_after;
      else if (Number.isInteger(p.range_start) && Number.isInteger(p.range_end) && typeof p.inserted_text === "string") {
        if (source.slice(p.range_start, p.range_end) !== p.deleted_text) throw new Error(`Source mismatch at event ${event.seq}`);
        source = source.slice(0, p.range_start) + p.inserted_text + source.slice(p.range_end);
        if (source.length !== p.source_length_after) throw new Error(`Source length mismatch at event ${event.seq}`);
      }
    }
    const evidence = review[event.seq];
    const blocks = p.visible_blocks || [];
    return {
      index, event: event.type, elapsedMs: event.elapsed_ms, source, previousSource, payload: p,
      sourceSteps: [event.seq], changed: source !== previousSource, legacyLabels: [],
      note: evidence?.reason || `Event #${event.seq}: ${event.type}${p.error_type ? ` · ${p.error_type}` : ""}${p.check ? ` · ${p.check.passed_count}/${p.check.total_count} tests passed` : ""}`,
      reading: event.type.startsWith("guide.") ? {
        title: p.document_path || p.guide_kind || "Documentation",
        location: `${p.page_url || p.document_path || ""} · ${p.position_start || ""}–${p.position_end || ""}`,
        excerpt: blocks.map((block) => block.text).join("\n\n"),
        precision: "Recorded visible text blocks and viewport position; visibility is not proof of attention.",
      } : null,
    };
  });
  const annotations = {};
  steps.forEach((step) => { const entry = review[step.sourceSteps[0]]; if (entry) annotations[step.index] = entry.codes; });
  const manifest = detail.manifest;
  return {
    trace: { id: manifest.session_id, participant: manifest.participant_id, label: `Trace ${manifest.participant_id.slice(0, 5)}`, task: manifest.task_id, stepCount: steps.length, status: manifest.status || "Unconfirmed",
      dataNote: "All raw events retained. Initial evidence-based annotations cover Programming patterns and General errors only; unmarked cells mean no supported label, not a confirmed absence." },
    codebook, steps, annotations,
  };
}
