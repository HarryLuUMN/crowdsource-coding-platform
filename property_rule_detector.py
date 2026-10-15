"""Detect trace properties. Method: docs/property-rule-detector.md."""

import argparse
import json
import re
from difflib import SequenceMatcher

from semantic_step_processor import SemanticStepProcessor


VERSION = "properties-v1"


def finding(code, steps, reason, status="supported"):
    unique_steps = []
    for index in steps:
        if index not in unique_steps:
            unique_steps.append(index)
    unique_steps.sort()
    return {
        "property": code,
        "status": status,
        "steps": unique_steps,
        "reason": reason,
        "rule_version": VERSION,
    }


def message(payload):
    parts = [payload.get("error_type"), payload.get("error_message")]
    for diagnostic in payload.get("diagnostics", []):
        parts.append(diagnostic.get("message"))
    text_parts = []
    for part in parts:
        if part:
            text_parts.append(str(part))
    return "\n".join(text_parts)


def is_reading(step):
    return bool(step.get("reading")) or step.get("event", "").startswith("guide.")


def is_edit(step):
    source = step.get("source", "")
    previous_source = step.get("previousSource", source)
    return source != previous_source


def is_paste(step):
    raw = step.get("rawSteps") or [step]
    for event in raw:
        if event.get("event") == "editor.paste":
            return True
    return False


class TraceEvidence:
    """Prepare evaluations and edit intervals without changing input."""

    def __init__(self, dataset, trace_complete=False, documentation_examples=None):
        self.steps = dataset["steps"]
        self.complete = trace_complete
        self.examples = documentation_examples or []
        self.processor = SemanticStepProcessor()
        self.runs = []
        self.collect_runs()
        self.episodes = []
        self.build_episodes()

    def collect_runs(self):
        """Read recorded results and ignore duplicate execution IDs."""
        seen = []
        result_events = ["run.completed", "run.failed", "submit.completed", "submit.failed", "compiler.execution"]
        for index in range(len(self.steps)):
            step = self.steps[index]
            result = step.get("runResult")
            if result:
                event = result.get("event")
                payload = result.get("payload") or {}
            else:
                event = step.get("event", "")
                if event not in result_events:
                    continue
                payload = step.get("payload") or {}
            execution_id = payload.get("execution_id")
            if execution_id and execution_id in seen:
                continue
            if execution_id:
                seen.append(execution_id)

            failed = False
            if event.endswith("failed"):
                failed = True
            if payload.get("error_type"):
                failed = True
            if payload.get("status") == "compiler_error":
                failed = True

            check = payload.get("check") or {}
            compiles = None
            for test in check.get("tests", []):
                if test.get("id") == "compiles":
                    compiles = test.get("passed")
                    break

            succeeded = False
            if not failed:
                if event.endswith("completed") or compiles is True:
                    succeeded = True

            # Failed execution is different from successful but wrong output.
            wrong_output = False
            if succeeded:
                if check.get("passed") is False:
                    wrong_output = True
                passed_count = check.get("passed_count")
                total_count = check.get("total_count")
                if isinstance(passed_count, int) and isinstance(total_count, int):
                    if passed_count < total_count:
                        wrong_output = True

            text = message(payload)
            syntax_error = False
            syntax_pattern = r"parsing[_ ]error|syntaxerror|syntax error|parseerror"
            if failed and re.search(syntax_pattern, text, re.I):
                syntax_error = True
            self.runs.append({
                "index": index,
                "source": step.get("source", ""),
                "payload": payload,
                "failed": failed,
                "wrong_output": wrong_output,
                "syntax_error": syntax_error,
                "message": text,
                "succeeded": succeeded,
            })

    def build_episodes(self):
        """Collect edits between each pair of evaluations."""
        for run_index in range(1, len(self.runs)):
            before = self.runs[run_index - 1]
            after = self.runs[run_index]
            edits = []
            for step_index in range(before["index"] + 1, after["index"] + 1):
                if is_edit(self.steps[step_index]):
                    edits.append(step_index)
            change = self.processor.compare(before["source"], after["source"])
            step_range = [before["index"]]
            step_range.extend(edits)
            step_range.append(after["index"])
            self.episodes.append({
                "before": before,
                "after": after,
                "edits": edits,
                "change": change,
                "range": step_range,
            })


def detect_document_reading_first(ctx):
    """Match only the opening document-reading series."""
    series = []
    for index, step in enumerate(ctx.steps):
        if is_reading(step):
            series.append(index)
        elif is_edit(step) or step.get("event", "").startswith(("run.", "submit.", "compiler.")):
            break
    if not series:
        return []
    reason = "The first task activity is a document-reading series."
    return [finding("DOC_FIRST", series, reason)]


def detect_incremental_construction(ctx):
    """Match one added unit between evaluations."""
    output = []
    for episode in ctx.episodes:
        change = episode["change"]
        if episode["edits"] and change["unitType"] in {"declaration_assignment", "expression_operation"}:
            output.append(finding("INCREMENTAL", episode["range"], "One added unit; behavioral relevance needs review.", "candidate"))
    return output


def local_episodes(ctx):
    episodes = []
    for episode in ctx.episodes:
        if not episode["edits"]:
            continue
        if episode["change"]["unitType"] == "small_span_modification":
            episodes.append(episode)
    return episodes


def detect_local_revision(ctx):
    """Match within-unit changes followed by evaluation."""
    output = []
    for episode in local_episodes(ctx):
        change = episode["change"]
        unit = change.get("unit") or {}
        before_unit = change.get("beforeUnit") or {}
        status = "supported"
        if unit.get("recognition") == "lexical_candidate":
            status = "candidate"
        if before_unit.get("recognition") == "lexical_candidate":
            status = "candidate"
        reason = "The net revision stays within one existing local unit."
        output.append(finding("LOCAL_REVISION", episode["range"], reason, status))
    return output


def detect_local_after_syntax(ctx):
    """Require a preceding recorded syntax error."""
    output = []
    for episode in local_episodes(ctx):
        if episode["before"]["syntax_error"]:
            reason = "A local revision follows a syntax-error evaluation."
            output.append(finding("LOCAL_AFTER_SYNTAX", episode["range"], reason, "candidate"))
    return output


def detect_local_after_output(ctx):
    """Require preceding successful execution with failed checks."""
    output = []
    for episode in local_episodes(ctx):
        if episode["before"]["wrong_output"]:
            reason = "A local revision follows failed output checks."
            output.append(finding("LOCAL_AFTER_OUTPUT", episode["range"], reason, "candidate"))
    return output


def detect_trial_and_error(ctx):
    """Count evaluated local attempts after viewing an error."""
    output = []
    attempts = 0
    sequence = []
    local = []
    for episode in local_episodes(ctx):
        local.append(episode["after"]["index"])
    for episode in ctx.episodes:
        before, after = episode["before"], episode["after"]
        if not (before["failed"] or before["wrong_output"]):
            attempts = 0
            sequence = []
            continue
        viewed = []
        for index in range(before["index"] + 1, after["index"]):
            event = ctx.steps[index].get("event")
            if event in ["output.console_viewed", "output.tests_viewed"]:
                viewed.append(index)
        if not sequence and not viewed:
            continue
        if after["index"] not in local:
            attempts = 0
            sequence = []
            continue
        sequence.extend(episode["range"])
        sequence.extend(viewed)
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
        has_later_edit = False
        for index in range(after["index"] + 1, len(ctx.steps)):
            if is_edit(ctx.steps[index]):
                has_later_edit = True
                break
        if has_later_edit:
            continue
        status = "unknown"
        if ctx.complete:
            status = "candidate"
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
        old = ctx.processor.analyze(before)
        new = ctx.processor.analyze(after)
        old_headers = []
        for unit in old["units"]:
            if unit.production.endswith("_header"):
                old_headers.append(before[unit.start:unit.end])
        new_headers = []
        for unit in new["units"]:
            if unit.production.endswith("_header"):
                new_headers.append(after[unit.start:unit.end])
        similarity = SequenceMatcher(None, old["tokens"], new["tokens"], autojunk=False).ratio()
        if similarity < 0.5 and old_headers != new_headers:
            output.append(finding("LARGE_CODE_SHIFT", [index], "Token similarity below 0.5 and structural headers changed.", "candidate"))
    return output


def detect_pastes_documentation(ctx):
    """Require a paste whose inserted text matches a known example."""
    output = []
    for index, step in enumerate(ctx.steps):
        if not is_paste(step):
            continue
        before, after = step.get("previousSource", ""), step.get("source", "")
        additions = []
        changes = SequenceMatcher(None, before, after, autojunk=False).get_opcodes()
        for change in changes:
            operation = change[0]
            after_start = change[3]
            after_end = change[4]
            if operation in ["insert", "replace"]:
                additions.append(after[after_start:after_end])
        inserted = "".join(additions).strip()
        matches_example = False
        for example in ctx.examples:
            if inserted == example.strip():
                matches_example = True
                break
        if inserted and matches_example:
            output.append(finding("PASTE_DOC", [index], "Inserted paste text exactly matches a supplied documentation example.", "candidate"))
    return output


def detect_paste_first(ctx):
    """Check the first source-changing activity."""
    for index in range(len(ctx.steps)):
        step = ctx.steps[index]
        if not is_edit(step):
            continue
        if is_paste(step):
            reason = "The first code-changing event contains a recorded paste."
            return [finding("PASTE_FIRST", [index], reason)]
        # Stop at the first edit, even when it is not a paste.
        return []
    return []


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
            pending = (index, step.get("previousSource", ""), step.get("source", ""))
            deleted = None
        elif pending:
            if step.get("previousSource") == pending[2] and step.get("source") == pending[1]:
                deleted = (pending[0], index)
            pending = None
        else:
            deleted = None
    return output


def error_matches(ctx, code, pattern, reason, status="candidate"):
    """Check failed evaluations one by one against a diagnostic pattern."""
    output = []
    for run in ctx.runs:
        if not run["failed"]:
            continue
        match = re.search(pattern, run["message"], re.I)
        if match:
            output.append(finding(code, [run["index"]], reason, status))
    return output


def detect_incomplete_token(ctx):
    """Look for explicit unfinished lexical-element diagnostics."""
    pattern = r"unterminated (?:string|literal)|unclosed (?:string|quote)|incomplete token"
    reason = "The diagnostic names an unfinished lexical element."
    return error_matches(ctx, "INCOMPLETE_TOKEN", pattern, reason, "supported")


def detect_wrong_token(ctx):
    """Do not classify every parser failure as a wrong token."""
    pattern = r"unexpected (?:token|character)|invalid (?:token|character)|illegal character"
    reason = "The diagnostic identifies an unexpected or invalid token."
    return error_matches(ctx, "WRONG_TOKEN", pattern, reason)


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
    pattern = r"unknown token|unrecognized (?:token|character)"
    reason = "The diagnostic names a token outside the language."
    return error_matches(ctx, "NON_LANGUAGE", pattern, reason)


def detect_incorrect_value(ctx):
    """Require a value-specific failure, not a numeric edit."""
    pattern = r"out of range|invalid value|value must|must be (?:positive|negative|between)"
    reason = "A value constraint is named in the error."
    return error_matches(ctx, "INCORRECT_VALUE", pattern, reason)


def detect_identifier_issue(ctx):
    """Match explicit name and field lookup errors."""
    pattern = r"NameError|AttributeError|not in scope|undefined (?:variable|name)|unknown (?:identifier|field)"
    reason = "The diagnostic identifies a name or field issue."
    return error_matches(ctx, "IDENTIFIER_ISSUE", pattern, reason, "supported")


def detect_incorrect_binding(ctx):
    """Keep binding errors distinct from generic NameError."""
    pattern = r"No_Declared_Carrier_Error|no declared working carriers|invalid binding|unbound (?:resource|carrier)"
    reason = "The diagnostic names a missing or invalid resource binding."
    return error_matches(ctx, "INCORRECT_BINDING", pattern, reason)


def detect_incorrect_declaration(ctx):
    """Require declaration-specific evidence."""
    pattern = r"invalid declaration|duplicate declaration|declaration required|incorrect declaration"
    reason = "The diagnostic explicitly concerns a declaration."
    return error_matches(ctx, "INCORRECT_DECLARATION", pattern, reason)


def detect_incorrect_reference(ctx):
    """Require reference-specific evidence."""
    pattern = r"invalid reference|unknown reference|reference to .*not found|dangling reference"
    reason = "The diagnostic explicitly concerns a reference."
    return error_matches(ctx, "INCORRECT_REFERENCE", pattern, reason)


def detect_incomplete_structure(ctx):
    """Use missing-structure diagnostics, not any expected-token list."""
    pattern = r"missing (?:semicolon|bracket|brace|parenthesis|block)|unclosed (?:bracket|brace|parenthesis)|expected:\s*\['[{};]'\]"
    reason = "The diagnostic identifies a missing structural delimiter."
    return error_matches(ctx, "INCOMPLETE_STRUCTURE", pattern, reason)


def detect_incorrect_arrangement(ctx):
    """Require explicit ordering or nesting constraints."""
    pattern = r"must start in .*direction|must (?:occur|appear|be called) before|invalid nesting|incorrect (?:order|scope|nesting)"
    reason = "The diagnostic names an ordering, nesting or scope constraint."
    return error_matches(ctx, "INCORRECT_ARRANGEMENT", pattern, reason)


def detect_wrong_output(ctx):
    """Inspect successful executions separately from error runs."""
    output = []
    for run in ctx.runs:
        if run["wrong_output"]:
            reason = "Execution succeeded, but task checks failed."
            output.append(finding("VALID_WRONG_OUTPUT", [run["index"]], reason))
    return output


DETECTORS = [
    detect_document_reading_first, detect_incremental_construction, detect_local_revision,
    detect_local_after_syntax, detect_local_after_output, detect_trial_and_error,
    detect_syntax_to_semantics, detect_large_code_shift, detect_pastes_documentation,
    detect_paste_first, detect_delete_repaste, detect_incomplete_token, detect_wrong_token,
    detect_other_language, detect_non_language, detect_incorrect_value, detect_identifier_issue,
    detect_incorrect_binding, detect_incorrect_declaration, detect_incorrect_reference,
    detect_incomplete_structure, detect_incorrect_arrangement, detect_wrong_output,
]


def detect_properties(dataset, trace_complete=False, documentation_examples=None):
    """Return proposals only; never update annotations."""
    ctx = TraceEvidence(dataset, trace_complete, documentation_examples)
    detections = []
    for detector in DETECTORS:
        results = detector(ctx)
        detections.extend(results)

    missing_details = []
    for run in ctx.runs:
        if not run["failed"]:
            continue
        payload = run["payload"]
        if payload.get("error_message"):
            continue
        if payload.get("diagnostics"):
            continue
        missing_details.append(run["index"])

    return {
        "rule_version": VERSION,
        "indexing": "zero-based input steps",
        "detections": detections,
        "coverage": {
            "evaluations": len(ctx.runs),
            "errors_without_detailed_messages": missing_details,
            "trace_complete_asserted": ctx.complete,
            "documentation_examples": len(ctx.examples),
        },
        "note": "No detection is not proof of absence; candidate and unknown findings need review.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset")
    parser.add_argument("--trace-complete", action="store_true")
    args = parser.parse_args()
    with open(args.dataset) as source:
        dataset = json.load(source)
    results = detect_properties(dataset, trace_complete=args.trace_complete)
    print(json.dumps(results, indent=2))
