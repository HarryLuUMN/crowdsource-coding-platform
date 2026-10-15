"""Detect trace properties. Method: docs/property-rule-detector.md."""

import argparse
import json
import re
from difflib import SequenceMatcher

from semantic_step_processor import SemanticStepProcessor


VERSION = "properties-v1"


def finding(code, steps, reason, status="supported"):
    return {"property": code, "status": status, "steps": sorted(set(steps)),
            "reason": reason, "rule_version": VERSION}


def message(payload):
    parts = [payload.get("error_type"), payload.get("error_message")]
    parts.extend(item.get("message") for item in payload.get("diagnostics", []))
    return "\n".join(str(part) for part in parts if part)


def is_reading(step):
    return bool(step.get("reading")) or step.get("event", "").startswith("guide.")


def is_edit(step):
    return step.get("source", "") != step.get("previousSource", step.get("source", ""))


def is_paste(step):
    raw = step.get("rawSteps") or [step]
    return any(item.get("event") == "editor.paste" for item in raw)


class TraceEvidence:
    """Prepare evaluations and edit intervals without changing input."""

    def __init__(self, dataset, trace_complete=False, documentation_examples=None):
        self.steps = dataset["steps"]
        self.complete = trace_complete
        self.examples = documentation_examples or []
        self.processor = SemanticStepProcessor()
        self.runs = []
        seen = set()
        for index, step in enumerate(self.steps):
            result = step.get("runResult")
            event = result.get("event") if result else step.get("event", "")
            if not result and event not in {"run.completed", "run.failed", "submit.completed", "submit.failed", "compiler.execution"}:
                continue
            payload = (result or step).get("payload") or {}
            execution_id = payload.get("execution_id")
            if execution_id and execution_id in seen:
                continue
            if execution_id:
                seen.add(execution_id)
            failed = event.endswith("failed") or bool(payload.get("error_type")) or payload.get("status") == "compiler_error"
            check = payload.get("check") or {}
            compiles = next((t.get("passed") for t in check.get("tests", []) if t.get("id") == "compiles"), None)
            succeeded = not failed and (event.endswith("completed") or compiles is True)
            wrong_output = succeeded and (check.get("passed") is False or (
                isinstance(check.get("passed_count"), int) and isinstance(check.get("total_count"), int)
                and check["passed_count"] < check["total_count"]))
            text = message(payload)
            self.runs.append({"index": index, "source": step.get("source", ""), "payload": payload,
                              "failed": failed, "wrong_output": wrong_output,
                              "syntax_error": failed and bool(re.search(r"parsing[_ ]error|syntaxerror|syntax error|parseerror", text, re.I)),
                              "message": text, "succeeded": succeeded})
        self.episodes = []
        for before, after in zip(self.runs, self.runs[1:]):
            edits = [i for i in range(before["index"] + 1, after["index"] + 1) if is_edit(self.steps[i])]
            change = self.processor.compare(before["source"], after["source"])
            self.episodes.append({"before": before, "after": after, "edits": edits, "change": change,
                                  "range": [before["index"], *edits, after["index"]]})


def detect_document_reading_first(ctx):
    """Match only the opening document-reading series."""
    series = []
    for index, step in enumerate(ctx.steps):
        if is_reading(step):
            series.append(index)
        elif is_edit(step) or step.get("event", "").startswith(("run.", "submit.", "compiler.")):
            break
    return [finding("DOC_FIRST", series, "The first task activity is a document-reading series.")] if series else []


def detect_incremental_construction(ctx):
    """Match one added unit between evaluations."""
    output = []
    for episode in ctx.episodes:
        change = episode["change"]
        if episode["edits"] and change["unitType"] in {"declaration_assignment", "expression_operation"}:
            output.append(finding("INCREMENTAL", episode["range"], "One added unit; behavioral relevance needs review.", "candidate"))
    return output


def local_episodes(ctx):
    return [e for e in ctx.episodes if e["edits"] and e["change"]["unitType"] == "small_span_modification"]


def detect_local_revision(ctx):
    """Match within-unit changes followed by evaluation."""
    return [finding("LOCAL_REVISION", e["range"], "The net revision stays within one existing local unit.",
                    "candidate" if any(u.get("recognition") == "lexical_candidate" for u in
                                       [e["change"].get("unit") or {}, e["change"].get("beforeUnit") or {}]) else "supported")
            for e in local_episodes(ctx)]


def detect_local_after_syntax(ctx):
    """Require a preceding recorded syntax error."""
    return [finding("LOCAL_AFTER_SYNTAX", e["range"], "A local revision follows a syntax-error evaluation.", "candidate")
            for e in local_episodes(ctx) if e["before"]["syntax_error"]]


def detect_local_after_output(ctx):
    """Require preceding successful execution with failed checks."""
    return [finding("LOCAL_AFTER_OUTPUT", e["range"], "A local revision follows failed output checks.", "candidate")
            for e in local_episodes(ctx) if e["before"]["wrong_output"]]


def detect_trial_and_error(ctx):
    """Count evaluated local attempts after viewing an error."""
    output, attempts, sequence = [], 0, []
    local = {e["after"]["index"] for e in local_episodes(ctx)}
    for episode in ctx.episodes:
        before, after = episode["before"], episode["after"]
        if not (before["failed"] or before["wrong_output"]):
            attempts, sequence = 0, []
            continue
        viewed = [i for i in range(before["index"] + 1, after["index"])
                  if ctx.steps[i].get("event") in {"output.console_viewed", "output.tests_viewed"}]
        if not sequence and not viewed:
            continue
        if after["index"] not in local:
            attempts, sequence = 0, []
            continue
        sequence.extend([*episode["range"], *viewed])
        attempts += 1
        if attempts >= 2:
            output.append(finding("TRIAL_ERROR", sequence, "At least two evaluated local attempts after an error-view event.", "candidate"))
    return output


def detect_syntax_to_semantics(ctx):
    """Check the later trajectory, not just compilation success."""
    output = []
    for episode in ctx.episodes:
        before, after = episode["before"], episode["after"]
        if not (before["syntax_error"] and after["succeeded"] and after["wrong_output"]):
            continue
        later = [i for i in range(after["index"] + 1, len(ctx.steps)) if is_edit(ctx.steps[i])]
        if later:
            continue
        status = "candidate" if ctx.complete else "unknown"
        output.append(finding("SYNTAX_SEMANTICS", episode["range"],
                              "Syntax resolved, output still wrong, and no later source edits observed; completeness is required.", status))
    return output


def detect_large_code_shift(ctx):
    """Require both broad replacement and changed structural headers."""
    output = []
    for index, step in enumerate(ctx.steps):
        if not is_edit(step):
            continue
        before, after = step.get("previousSource", ""), step.get("source", "")
        if not before.strip() or not after.strip():
            continue
        old, new = ctx.processor.analyze(before), ctx.processor.analyze(after)
        headers = lambda analysis, source: [source[u.start:u.end] for u in analysis["units"] if u.production.endswith("_header")]
        similarity = SequenceMatcher(None, old["tokens"], new["tokens"], autojunk=False).ratio()
        if similarity < 0.5 and headers(old, before) != headers(new, after):
            output.append(finding("LARGE_CODE_SHIFT", [index], "Token similarity below 0.5 and structural headers changed.", "candidate"))
    return output


def detect_pastes_documentation(ctx):
    """Require a paste whose inserted text matches a known example."""
    output = []
    for index, step in enumerate(ctx.steps):
        if not is_paste(step):
            continue
        before, after = step.get("previousSource", ""), step.get("source", "")
        additions = [after[c:d] for tag, a, b, c, d in SequenceMatcher(None, before, after, autojunk=False).get_opcodes() if tag in {"insert", "replace"}]
        inserted = "".join(additions).strip()
        if inserted and any(inserted == example.strip() for example in ctx.examples):
            output.append(finding("PASTE_DOC", [index], "Inserted paste text exactly matches a supplied documentation example.", "candidate"))
    return output


def detect_paste_first(ctx):
    """Check the first source-changing activity."""
    first = next((i for i, s in enumerate(ctx.steps) if is_edit(s)), None)
    return [finding("PASTE_FIRST", [first], "The first code-changing event contains a recorded paste.")] if first is not None and is_paste(ctx.steps[first]) else []


def detect_delete_repaste(ctx):
    """Require deletion before any intervening modification."""
    output = []
    pending = None
    deleted = None
    for index, step in enumerate(ctx.steps):
        if not is_edit(step):
            continue
        if is_paste(step):
            if deleted is not None:
                output.append(finding("DELETE_REPASTE", [deleted[0], deleted[1], index], "Paste was cleared without intervening edits, then another paste occurred."))
            pending, deleted = (index, step.get("previousSource", ""), step.get("source", "")), None
        elif pending:
            if step.get("previousSource") == pending[2] and step.get("source") == pending[1]:
                deleted = (pending[0], index)
            pending = None
        else:
            deleted = None
    return output


def error_matches(ctx, code, pattern, reason, status="candidate"):
    return [finding(code, [run["index"]], reason, status) for run in ctx.runs
            if run["failed"] and re.search(pattern, run["message"], re.I)]


def detect_incomplete_token(ctx):
    """Look for explicit unfinished lexical-element diagnostics."""
    return error_matches(ctx, "INCOMPLETE_TOKEN", r"unterminated (?:string|literal)|unclosed (?:string|quote)|incomplete token",
                         "The diagnostic names an unfinished lexical element.", "supported")


def detect_wrong_token(ctx):
    """Do not classify every parser failure as a wrong token."""
    return error_matches(ctx, "WRONG_TOKEN", r"unexpected (?:token|character)|invalid (?:token|character)|illegal character",
                         "The diagnostic identifies an unexpected or invalid token.")


def detect_other_language(ctx):
    """Match foreign-language forms only on failed evaluations."""
    output = []
    for run in ctx.runs:
        if not run["failed"]:
            continue
        if re.search(r";!knitout-", run["source"]) or re.search(r"^\s*from\s+\w+\s+import\s+", run["source"], re.M):
            output.append(finding("OTHER_LANGUAGE", [run["index"]], "Failed source contains a known foreign-language form; causality needs review.", "candidate"))
    return output


def detect_non_language(ctx):
    """Require an explicit unrecognized-token diagnostic."""
    return error_matches(ctx, "NON_LANGUAGE", r"unknown token|unrecognized (?:token|character)",
                         "The diagnostic names a token outside the language.")


def detect_incorrect_value(ctx):
    """Require a value-specific failure, not a numeric edit."""
    return error_matches(ctx, "INCORRECT_VALUE", r"out of range|invalid value|value must|must be (?:positive|negative|between)",
                         "A value constraint is named in the error.")


def detect_identifier_issue(ctx):
    """Match explicit name and field lookup errors."""
    return error_matches(ctx, "IDENTIFIER_ISSUE", r"NameError|AttributeError|not in scope|undefined (?:variable|name)|unknown (?:identifier|field)",
                         "The diagnostic identifies a name or field issue.", "supported")


def detect_incorrect_binding(ctx):
    """Keep binding errors distinct from generic NameError."""
    return error_matches(ctx, "INCORRECT_BINDING", r"No_Declared_Carrier_Error|no declared working carriers|invalid binding|unbound (?:resource|carrier)",
                         "The diagnostic names a missing or invalid resource binding.")


def detect_incorrect_declaration(ctx):
    """Require declaration-specific evidence."""
    return error_matches(ctx, "INCORRECT_DECLARATION", r"invalid declaration|duplicate declaration|declaration required|incorrect declaration",
                         "The diagnostic explicitly concerns a declaration.")


def detect_incorrect_reference(ctx):
    """Require reference-specific evidence."""
    return error_matches(ctx, "INCORRECT_REFERENCE", r"invalid reference|unknown reference|reference to .*not found|dangling reference",
                         "The diagnostic explicitly concerns a reference.")


def detect_incomplete_structure(ctx):
    """Use missing-structure diagnostics, not any expected-token list."""
    return error_matches(ctx, "INCOMPLETE_STRUCTURE", r"missing (?:semicolon|bracket|brace|parenthesis|block)|unclosed (?:bracket|brace|parenthesis)|expected:\s*\['[{};]'\]",
                         "The diagnostic identifies a missing structural delimiter.")


def detect_incorrect_arrangement(ctx):
    """Require explicit ordering or nesting constraints."""
    return error_matches(ctx, "INCORRECT_ARRANGEMENT", r"must start in .*direction|must (?:occur|appear|be called) before|invalid nesting|incorrect (?:order|scope|nesting)",
                         "The diagnostic names an ordering, nesting or scope constraint.")


def detect_wrong_output(ctx):
    """Inspect successful executions separately from error runs."""
    return [finding("VALID_WRONG_OUTPUT", [run["index"]], "Execution succeeded, but task checks failed.")
            for run in ctx.runs if run["wrong_output"]]


DETECTORS = [
    detect_document_reading_first, detect_incremental_construction, detect_local_revision,
    detect_local_after_syntax, detect_local_after_output, detect_trial_and_error,
    detect_syntax_to_semantics, detect_large_code_shift, detect_pastes_documentation,
    detect_paste_first, detect_delete_repaste, detect_incomplete_token, detect_wrong_token,
    detect_other_language, detect_non_language, detect_incorrect_value, detect_identifier_issue,
    detect_incorrect_binding, detect_incorrect_declaration, detect_incorrect_reference,
    detect_incomplete_structure, detect_incorrect_arrangement, detect_wrong_output,
]


def detect_properties(dataset, **options):
    """Return proposals only; never update annotations."""
    ctx = TraceEvidence(dataset, **options)
    return {"rule_version": VERSION, "indexing": "zero-based input steps",
            "detections": [item for detector in DETECTORS for item in detector(ctx)],
            "coverage": {"evaluations": len(ctx.runs),
                         "errors_without_detailed_messages": [r["index"] for r in ctx.runs if r["failed"] and not r["payload"].get("error_message") and not r["payload"].get("diagnostics")],
                         "trace_complete_asserted": ctx.complete,
                         "documentation_examples": len(ctx.examples)},
            "note": "No detection is not proof of absence; candidate and unknown findings need review."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset")
    parser.add_argument("--trace-complete", action="store_true")
    args = parser.parse_args()
    with open(args.dataset) as source:
        print(json.dumps(detect_properties(json.load(source), trace_complete=args.trace_complete), indent=2))
