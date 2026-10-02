"use strict";

const ANNOTATION_RULES = [
  ["DOC_FIRST", "high"], ["INCREMENTAL", "medium-high"], ["LOCAL_REVISION", "high"],
  ["LOCAL_AFTER_SYNTAX", "high"], ["LOCAL_AFTER_OUTPUT", "high"], ["TRIAL_ERROR", "medium-high"],
  ["SYNTAX_SEMANTICS", "medium"], ["PASTE_DOC", "medium"], ["PASTE_FIRST", "high"],
  ["DELETE_REPASTE", "high"], ["INCOMPLETE_TOKEN", "high"], ["WRONG_TOKEN", "high"],
  ["OTHER_LANGUAGE", "high"], ["NON_LANGUAGE", "high"], ["INCORRECT_VALUE", "medium-high"],
  ["IDENTIFIER_ISSUE", "high"], ["INCORRECT_BINDING", "medium-high"],
  ["INCORRECT_DECLARATION", "medium-high"], ["INCORRECT_REFERENCE", "medium-high"],
  ["INCOMPLETE_STRUCTURE", "high"], ["INCORRECT_ARRANGEMENT", "medium"],
  ["VALID_WRONG_OUTPUT", "high"],
].map(([code, level]) => ({ code, level }));

function annotationSourceChange(before, after) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let a = before.length, b = after.length;
  while (a > start && b > start && before[a - 1] === after[b - 1]) { a--; b--; }
  return { start, removed: before.slice(start, a), inserted: after.slice(start, b) };
}

function annotationStatements(source) {
  const result = [];
  let token = "", quote = "", escape = false, comment = false, round = 0, square = 0, braces = 0;
  for (const c of source) {
    if (comment) { if (c === "\n") comment = false; else continue; }
    if (quote) {
      token += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "#") { comment = true; continue; }
    if (c === '"' || c === "'") { quote = c; token += c; continue; }
    if (c === "(") round++; if (c === ")") round--;
    if (c === "[") square++; if (c === "]") square--;
    if (c === "{") braces++; if (c === "}") braces--;
    if (round < 0 || square < 0 || braces < 0) return null;
    token += c;
    if ((c === ";" || c === "{" || c === "}") && round === 0 && square === 0) { result.push(token.trim()); token = ""; }
  }
  if (quote || round || square || braces || token.trim()) return null;
  return result;
}

function detectAnnotationRules(dataset) {
  const detections = [];
  const supported = new Set(dataset.codebook.flatMap(g => g.codes.map(c => c.id)));
  const add = (step, code, status, reason, related = []) => {
    if (!supported.has(code)) return;
    const id = `${step.index}:${code}`;
    if (detections.some(d => d.id === id)) return;
    detections.push({ id, step: step.index, code, status, ruleVersion: "1.0.0", reason,
      evidence: { events: [...new Set([...related, step].map(s => s.sourceSteps?.[0] ?? s.index))],
        event: step.event, before: step.previousSource || "", after: step.source || "", payload: step.payload || {} } });
  };
  let firstEdit = null, previousEvaluation = null, previousOutcome = null;
  let lastPaste = null, deletedPaste = false, pasteEdited = false, localAttempts = 0, errorViewed = false;
  const readings = [];
  for (const step of dataset.steps) {
    const p = step.payload || {}, source = step.source || "";
    const isEdit = step.event.startsWith("editor.") && (step.changed || source !== (step.previousSource || ""));
    if (step.reading) readings.push(step);
    if (isEdit && firstEdit === null) {
      firstEdit = step;
      const tutorial = readings.find(s => /tutorial/i.test(`${s.reading?.title} ${s.payload?.guide_kind} ${s.event}`) && s.reading?.excerpt?.trim());
      if (tutorial) add(tutorial, "DOC_FIRST", "candidate", "Tutorial text was visible before the first edit; confirm that this represents reading.", [step]);
      if (step.event === "editor.paste") add(step, "PASTE_FIRST", "auto", "The first source-changing editor event is a paste.");
    }
    if (step.event === "editor.paste" && isEdit) {
      if (lastPaste && deletedPaste && !pasteEdited) add(step, "DELETE_REPASTE", "auto", "The previous paste was removed before being edited, followed by another paste.", [lastPaste]);
      const change = annotationSourceChange(step.previousSource || "", source);
      const inserted = p.inserted_text || change.inserted;
      const normalize = s => s.replace(/\s+/g, " ").trim();
      const matching = readings.find(s => inserted.trim().length >= 20 && normalize(s.reading?.excerpt || "").includes(normalize(inserted)));
      add(step, "PASTE_DOC", "candidate", matching ? "Pasted text matches previously visible documentation; verify it is an example and its origin." : "A paste occurred; inspect the pasted fragment and preceding documentation to establish its origin.", matching ? [matching] : []);
      lastPaste = step; deletedPaste = false; pasteEdited = false;
    } else if (isEdit && lastPaste && !deletedPaste) {
      if (source === (lastPaste.previousSource || "")) deletedPaste = true;
      else pasteEdited = true;
    }
    if (step.event === "output.console_viewed" && previousOutcome?.event === "run.failed") errorViewed = true;
    const evaluated = /^(run|submit)\.(requested|completed|failed|accepted)$/.test(step.event);
    if (!evaluated) continue;
    if (/\.(requested)$/.test(step.event)) {
      if (previousEvaluation && source !== previousEvaluation.source) {
        const before = previousEvaluation.source || "", delta = annotationSourceChange(before, source);
        const oldStatements = annotationStatements(before), newStatements = annotationStatements(source);
        const changedStatements = oldStatements && newStatements && oldStatements.length === newStatements.length
          ? oldStatements.filter((s, i) => s !== newStatements[i]).length : null;
        const local = changedStatements === 1 && !/[;{}\n]/.test(delta.removed + delta.inserted)
          && (delta.removed.trim() || delta.inserted.trim()) && delta.removed.length < (oldStatements.find((s, i) => s !== newStatements[i]) || "").length;
        if (local) {
          add(step, "LOCAL_REVISION", "auto", "One existing semicolon-delimited statement changes internally before reevaluation.", [previousEvaluation]);
          if (previousOutcome?.event === "run.failed" && /parsing|syntax|parse/i.test(previousOutcome.payload?.error_type || "")) add(step, "LOCAL_AFTER_SYNTAX", "auto", "The preceding evaluation reported a parser/syntax error.", [previousOutcome]);
          const check = previousOutcome?.payload?.check;
          if (check && check.passed_count < check.total_count && previousOutcome.event === "run.completed") add(step, "LOCAL_AFTER_OUTPUT", "auto", "The preceding successful execution failed task checks.", [previousOutcome]);
          if (previousOutcome?.event === "run.failed" || localAttempts) {
            localAttempts++;
            if (localAttempts >= 2) add(step, "TRIAL_ERROR", errorViewed ? "auto" : "candidate", errorViewed ? "After opening the error console, at least two local revision/evaluation attempts occur." : "At least two local attempts follow an error; verify that the error was read.", [previousEvaluation]);
          }
        } else add(step, "LOCAL_REVISION", "candidate", "Source changed since the last evaluation; inspect whether the change is smaller than a complete statement.", [previousEvaluation]);
        if (oldStatements && newStatements && newStatements.length === oldStatements.length + 1) {
          let i = 0, j = 0, added = [];
          while (j < newStatements.length) { if (oldStatements[i] === newStatements[j]) { i++; j++; } else added.push(newStatements[j++]); }
          if (i === oldStatements.length && added.length === 1) add(step, "INCREMENTAL", "candidate", "Exactly one semicolon-delimited statement was added; confirm grammatical validity and behavior effect.", [previousEvaluation]);
        }
      }
      previousEvaluation = step;
    } else {
      const error = `${p.error_type || ""} ${p.error_message || p.message || ""} ${p.stderr || ""}`;
      const syntax = /parsing|syntax|parse/i.test(error);
      if (step.event === "run.failed") {
        if (/undefined|not defined|unknown (variable|identifier)|NameError/i.test(error)) add(step, "IDENTIFIER_ISSUE", "auto", "The compiler explicitly reports an undefined/unknown identifier.");
        if (/unexpected (end|eof)|unterminated|unclosed|missing.*(brace|parenthesis|delimiter)/i.test(error)) {
          add(step, "INCOMPLETE_STRUCTURE", "auto", "The diagnostic explicitly reports an unclosed or missing structural delimiter.");
          add(step, "INCOMPLETE_TOKEN", "candidate", "Check whether the missing element is part of a lexical token or a larger structure.");
        }
        if (syntax) {
          for (const code of ["WRONG_TOKEN", "INCOMPLETE_TOKEN", "INCOMPLETE_STRUCTURE", "INCORRECT_ARRANGEMENT"]) add(step, code, "candidate", "Parser failure: inspect the reported location and surrounding source to distinguish token, missing structure, and arrangement errors.");
          if (/^\s*(import |from .* import |def |print\()/m.test(source)) add(step, "OTHER_LANGUAGE", "candidate", "Python-like constructs occur in the failed source; verify that they cause the error in this DSL.");
          add(step, "NON_LANGUAGE", "candidate", "Check the problematic token against the DSL vocabulary; a syntax failure alone does not establish this label.");
        } else {
          for (const code of ["INCORRECT_VALUE", "INCORRECT_BINDING", "INCORRECT_DECLARATION", "INCORRECT_REFERENCE", "INCORRECT_ARRANGEMENT"]) add(step, code, "candidate", "Runtime failure: inspect the diagnostic, source and subsequent repair to determine the cause.");
        }
      }
      const check = p.check;
      if (step.event === "run.completed" || step.event === "submit.accepted") {
        const increment = detections.find(d => d.step === previousEvaluation?.index && d.code === "INCREMENTAL");
        if (increment) {
          const oldStatements = annotationStatements(increment.evidence.before) || [], newStatements = annotationStatements(increment.evidence.after) || [];
          const added = newStatements.filter(s => !oldStatements.includes(s));
          if (added.length === 1 && /^\s*(knit|tuck|miss|xfer|drop|releasehook|inhook|outhook)\b/.test(added[0])) {
            increment.status = "auto";
            increment.reason = "One machine-operation statement was added and the subsequent execution succeeded, establishing grammatical validity and a behavior effect.";
            increment.evidence.events.push(step.sourceSteps?.[0] ?? step.index);
          }
        }
        if (check && Number.isFinite(check.passed_count) && check.total_count > 0 && check.passed_count < check.total_count) add(step, "VALID_WRONG_OUTPUT", "auto", `Execution succeeded but only ${check.passed_count}/${check.total_count} task checks passed.`);
        if (previousOutcome?.event === "run.failed" && /parsing|syntax|parse/i.test(previousOutcome.payload?.error_type || "")) add(step, "SYNTAX_SEMANTICS", "candidate", "A successful execution follows a syntax error; inspect the remaining trace for subsequent behavioral repairs.", [previousOutcome]);
      }
      if (!previousEvaluation) previousEvaluation = step;
      previousOutcome = step;
    }
  }
  return { version: "1.0.0", registry: ANNOTATION_RULES, detections };
}

if (typeof module !== "undefined") module.exports = { detectAnnotationRules, annotationSourceChange, annotationStatements, ANNOTATION_RULES };
