# Property Rule Detector

`property_rule_detector.py` is an independent proposal generator. It never writes
datasets, applies labels, or changes the existing UI detector. Only Programming
patterns and General Errors are included, not KnitScript-specific challenge codes.
Each property has one `detect_*` function in the `DETECTORS` registry. Short English
comments describe each rule; this document contains the usage and limitations.

## Usage

```sh
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python property_rule_detector.py annotation_data/s4-units.json
```

Results print to standard output. Indices are zero-based positions in the input
`steps`, not displayed one-based step numbers. `--trace-complete` explicitly asserts
complete observation for end-of-trace patterns; a task's passed status alone does
not establish telemetry completeness. Documentation examples can be supplied as
strings through the Python `documentation_examples` option.

## Evidence and rules

Evaluations are normalized from recorded result events or embedded `runResult`.
Requests without results are not treated as completed evaluations. Execution IDs
deduplicate repeated representations. Coarse execution notes are not diagnostic
evidence. Raw event inputs provide the best reading/paste evidence; semantic inputs
can omit such events. Both representations must not be concatenated or counted as
independent observations.

| Property function | Operational rule |
| --- | --- |
| document_reading_first | Opening document-reading activities before the first edit/evaluation; administrative events are ignored. |
| incremental_construction | One inserted local declaration/operation between evaluations; candidate because behavioral relevance is not proven. |
| local_revision | Net change confined to one existing local unit between evaluations. Lexical candidates remain candidate findings. |
| local_after_syntax | Local revision with a preceding recorded syntax error; conservative candidate. |
| local_after_output | Local revision after successful execution with failed checks; candidate. |
| trial_and_error | Error result, console/tests view, at least two consecutive evaluated local revisions; candidate. This is a conservative subset of the PDF definition. |
| syntax_to_semantics | Syntax failure followed by successful execution with wrong output and no later source edits; candidate only if trace completeness is asserted, otherwise unknown. |
| large_code_shift | Token similarity below 0.5 plus changed structural headers; fuzzy candidate, not a validated threshold. |
| pastes_documentation | Paste insertion exactly matches a supplied documentation example; provenance remains candidate. |
| paste_first | First source-changing activity contains a recorded paste. |
| delete_repaste | Pasted state restored to pre-paste source without another edit, followed by another paste. Conservative whole-paste removal rule. |
| incomplete_token | Failed evaluation explicitly reports an unfinished string/literal/token. |
| wrong_token | Failed evaluation explicitly reports unexpected/invalid/illegal token or character; candidate. |
| other_language | Failed source contains known foreign forms; candidate until diagnostic causality is reviewed. |
| non_language | Error explicitly names unknown/unrecognized tokens; candidate. |
| incorrect_value | Error explicitly names a value constraint; candidate. Successful wrong-output runs are not attributed to numeric causes automatically. |
| identifier_issue | Error identifies a missing name/field or NameError/AttributeError. |
| incorrect_binding | Binding/resource-specific diagnostics, not every NameError. |
| incorrect_declaration | Declaration-specific diagnostic patterns. |
| incorrect_reference | Reference-specific diagnostic patterns. |
| incomplete_structure | Explicit missing delimiter or singleton expected delimiter; not arbitrary expected-token lists. |
| incorrect_arrangement | Explicit order, nesting, scope or starting-direction constraint. |
| wrong_output | Successful execution with failed task checks; compiler failures are excluded. |

Error functions examine failed evaluations only, except wrong_output which examines
successful ones. Generic Parsing_Error without diagnostic detail yields no guessed
root cause and is listed in coverage gaps. Pattern functions inspect sequences,
not isolated code snapshots. One result may support multiple error properties.

## Output and limitations

Every finding contains property, status, input-step evidence, reason and rule
version. `supported` means an observable rule matched, not human intent proven.
`candidate` requires review; `unknown` records censored evidence. No finding is not
proof of absence. Labels are independent of existing manual annotations.

Local-unit recognition reuses the experimental SemanticStepProcessor. It is an
analysis dependency, not compiler execution. Net-diff matching can miss several
local revisions within an evaluation interval. Snapshot-only changes cannot prove
the intervening actions, and the conservative progression rule skips cases with
any later edits, even if those edits might be unrelated. Repeated synthetic paste
pieces and missing timestamps/result associations require careful input selection.
Trials require an observed console/tests view but cannot establish attention.
Foreign-language regexes and diagnostic patterns are intentionally incomplete.

These are initial operational rules, not benchmarked accuracy claims. Validate
against manually reviewed traces before using detections as research labels.

## Read-only smoke test

The 6638e semantic dataset supplies 24 evaluations. The first run produced 26
proposals (11 supported, 15 candidate) across 10 properties; no original dataset
JSON hash changed. This is an execution/coverage check, not annotation accuracy.
Properties without proposals can reflect missing reading/paste evidence or
conservative rules, rather than confirmed absence. No proposals were applied.
