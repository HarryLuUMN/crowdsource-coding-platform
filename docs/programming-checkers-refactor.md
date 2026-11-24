# Per-task programming checker refactor

## Scope and intent

Move the twelve current task rubrics into `programming-checkers/{knitscript,idyll,penrose,vegalite}/task{1,2,3}_checker` with Python or CommonJS extensions. Each task file owns its requirements and check definitions. Share evidence parsing, safe evaluation, result formatting, and process boundaries without duplicating their implementations.

## Behavior lock before edits

Capture exact check payloads for all twelve real reference answers, one incorrect answer per task, and compilation failures for all four languages. Run those contracts and the existing suite before changing the existing checker implementations. Preserve check IDs, order, labels, messages, success criteria, task IDs, and the frontend response shape. Existing security/negative tests remain mandatory.

## Ordered changes

1. Separate Python task rubrics from common Knitout, chart, and geometry evidence helpers.
2. Separate Idyll task rules from common scalar/advanced AST models and bounded expression evaluation. Keep retired Idyll rules available for existing tests and historical compatibility.
3. Add one explicit task-ID registry and route actual server execution through it. Keep old public imports as compatibility adapters, with no duplicated rule bodies.
4. Re-run contracts, all negative tests, all twelve example-answer files, and sequential submissions; exercise advanced Idyll browser interactions and task progression.

## Constraints

No new dependencies, task changes, grading changes, frontend layout changes, or modifications to saved research data. The hyphenated directory is loaded through an explicit Python registry; shared Python modules use a real package prefix to avoid duplicate module identities. Existing subprocess timeout and memory limits remain.
