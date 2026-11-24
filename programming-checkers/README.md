# Programming checkers

The twelve current study tasks each own a checker file. Folder and task numbering match the [example-answer repository](https://github.com/HarryLuUMN/crowdsourcing-task-example-answers).

```text
programming-checkers/
  registry.json
  knitscript/task{1,2,3}_checker.py
  idyll/task{1,2,3}_checker.cjs
  penrose/task{1,2,3}_checker.py
  vegalite/task{1,2,3}_checker.py
  shared/
```

`registry.json` maps the exact catalog task IDs to these files. The server calls `programming_checkers.check_task(task_id, result)` after compilation; this registry selects the actual rubric. Python modules export `check(result, task_id)` and return the existing full check payload. Idyll modules export `check(ast, data)` and return the ordered check units; the Python dispatcher retains the bounded Node subprocess and formats the same payload.

Each task file defines its own requirements, check IDs, labels and messages. `shared/` owns result formatting, compiled-evidence parsing, chart/geometry helpers, Idyll AST models, and bounded safe expression interpretation. It does not select current task rubrics. Idyll expressions are interpreted without executing participant JavaScript on the server.

`catalog_checks.py`, `structured_checks.py` and the old Idyll scripts remain compatibility adapters for existing imports and tooling. Retired Idyll converter/conditional rules are isolated in `shared/idyll_legacy.cjs`; they are not registered as current study tasks. The older standalone KnitScript/Vega task checkers remain separate from the twelve-task catalog.

To change a rubric, edit the corresponding task file and its meaningful positive/negative cases. To add a study task, update `study_tasks.py`, add its checker, and register its exact ID. Do not put new task-specific branches into shared evidence helpers.

Verification from the platform root:

```bash
.venv/bin/python -m unittest discover -s tests -v
```

`tests/test_checker_contracts.py` compares complete check payloads against 28 pre-refactor cases (twelve correct answers, twelve incorrect answers and four compilation failures). `tests/test_programming_checker_registry.py` checks catalog coverage and dispatch. The remaining suites cover negative/safety behavior and sequential submissions.
