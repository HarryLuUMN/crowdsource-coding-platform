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

## Completed verification

- Baseline: all 146 existing/contract tests passed before extracting the existing implementations.
- Integrated result: all 149 tests passed, including exact equality of all 28 recorded payloads, negative/safety tests, registry coverage, and accepted sequential submissions for all twelve tasks.
- All twelve files in the example-answer repository passed against committed platform `309749b` (57 of 57 check units).
- Real Chrome tests `tests/idyll_task_flow_browser.cjs` and `tests/idyll_advanced_browser.cjs` passed, covering practice, onboarding, advanced Run/Checks, sequential completion, linked views, reverse scrolling, pinned geometry and persistent controls.
- `npm run build`, Python byte compilation, CommonJS syntax checks and `git diff --check` passed. There are no separate lint/typecheck commands configured in `package.json`.
- The bounded advanced Idyll expression interpreter was moved byte-for-byte; the original script is a compatibility export. Docker's existing `COPY . .` includes the new checker directory.

This verification locks the existing behavior; it does not establish that the pre-existing rubrics accept every valid alternative solution. No grading improvements are included in this structural refactor.
