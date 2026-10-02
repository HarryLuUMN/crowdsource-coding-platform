# Rule-based behavioral annotation

Rules run on reconstructed source snapshots, event payloads and evaluation results. Labels cover the ten Programming Patterns and twelve General Errors in the supplied codebook. Detection levels describe intended feasibility, not measured accuracy. Precision and recall have not yet been established against an independently labeled corpus.

Each match includes a stable step/code ID, rule version, event references, source before/after, diagnostic payload and explanation. `auto` means direct evidence meets the implemented rule. `candidate` requires review. Confirm/reject decisions persist locally and export with the full evidence in JSON. Existing annotations remain separate from these results.

| Code | Direct detection / candidate condition |
| --- | --- |
| DOC_FIRST | Tutorial text before first edit creates a candidate: visibility does not establish attention. |
| INCREMENTAL | Exactly one semicolon-delimited statement added creates a candidate. A machine operation followed by successful execution can be automatic. Arbitrary assignments require behavioral review. |
| LOCAL_REVISION | One existing statement changes internally without changing statement/block delimiters, then reevaluation. Other changed evaluation intervals are candidates. |
| LOCAL_AFTER_SYNTAX | A proven local revision follows a parser/syntax failure. |
| LOCAL_AFTER_OUTPUT | A proven local revision follows successful execution with failed task checks. |
| TRIAL_ERROR | Two local revision/evaluation attempts after an error; opening the error console supplies exposure evidence. Otherwise candidate. |
| SYNTAX_SEMANTICS | Successful execution after a syntax failure creates a candidate; review the remaining trace for behavioral repairs. |
| PASTE_DOC | A paste creates a candidate; matching previously visible documentation strengthens evidence. Confirm an example and its origin. |
| PASTE_FIRST | First source-changing editing event is a paste. |
| DELETE_REPASTE | Exact restoration of pre-paste source before any other edit, followed by another paste. |
| IDENTIFIER_ISSUE | Explicit undefined/unknown identifier diagnostic. |
| INCOMPLETE_STRUCTURE | Explicit missing/unclosed structural delimiter diagnostic; generic parser errors are candidates. |
| INCOMPLETE_TOKEN, WRONG_TOKEN | Parser failures create candidates; inspect the error location and token. |
| OTHER_LANGUAGE | Python-like constructs plus parser failure create a candidate; cross-language appearance alone is insufficient. |
| NON_LANGUAGE | Parser failure creates a candidate requiring vocabulary verification. |
| INCORRECT_VALUE, INCORRECT_BINDING, INCORRECT_DECLARATION, INCORRECT_REFERENCE | Runtime failures create candidates. Confirm the cause from the diagnostic and subsequent repair. |
| INCORRECT_ARRANGEMENT | Parser/runtime failure creates a candidate requiring nesting/order/scope inspection. |
| VALID_WRONG_OUTPUT | Successful execution with valid nonzero check total and fewer passing checks. |

The statement scanner recognizes quotes, comments and balanced delimiters; it is not a DSL parser. Rules abstain when snapshots or diagnostics are absent. Curated traces with missing raw payloads will produce fewer detections. Reading exposure, console exposure and pasting do not by themselves establish attention, comprehension or provenance.

Review candidates through the selected step's Rule detections panel and its source/change/reading tabs. Yellow outlined grid cells are unresolved candidates. Confirmed and automatically applied labels appear in the applied grid. Next pending candidate navigates between steps. Export JSON stores findings and decisions; importing restores decisions.

Verification: `node tests/test_annotation_rules.cjs`, `node tests/test_annotation_session.cjs`.
