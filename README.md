# KnitScript Studio

A browser-based environment for writing KnitScript and compiling it through the real KnitScript toolchain. It also records replayable programming traces and preserves every compiler result for later benchmark analysis.

## Run locally

Python 3.12 is recommended.

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python server.py
```

Open [http://127.0.0.1:8000/?preview=1](http://127.0.0.1:8000/?preview=1), write a program from scratch, and press **Run** or <kbd>Cmd/Ctrl</kbd> + <kbd>Enter</kbd>.

Vega-Lite sales task: [local preview](http://127.0.0.1:8000/?preview=1&task=vega-lite-sales-v1). Node.js is required in addition to Python for this task (included in the Docker image). Local formal-task language selectors can switch between tasks; production selectors stay locked. To assign Vega-Lite, use `?task=vega-lite-sales-v1` on the study URL and retain the Prolific ID parameters. Each task has a separate draft and telemetry outbox. The task supports single-view specifications referencing `/sales-data.json`, without data transformations, aggregation, binning, or time-unit conversion. Checks validate task structure and execute the compiled chart with the pinned official runtime; they do not assess the aesthetic quality of titles or prove that the participant interacted with every mark.

## Trace storage

No database is required for the MVP. Each browser visit creates one directory under `data/traces/`:

```text
data/traces/<session-id>/
├── manifest.json
├── events/<batch-id>.jsonl
├── delta-observations/
│   ├── delta-session1-step0.txt
│   ├── delta-session1-step1.txt
│   └── step_labels.jsonl
├── code/
│   ├── source-initial.ks
│   ├── source-final.ks
│   └── <source-sha256>.ks
├── executions/<execution-id>/
│   ├── source.ks
│   ├── result.json
│   ├── output.k
│   ├── error.k
│   ├── stdout.txt
│   └── stderr.txt
└── submissions/<submission-id>.json
```

The event stream records semantic edits (inserted/deleted text and offsets), paste, undo/redo, reset, run requests, compiler outcomes, output views, visibility changes, and session timing. Compiler bundles include the exact source, full knitout or partial error knitout, diagnostics, logs, metrics, duration, exit code, and toolchain versions.

`delta-observations/` is an analysis-ready materialized view compatible with the benchmark trajectory layout used by `dsl-bench-alpha-delta-obs`. Every accepted code edit produces a complete source snapshot. Tutorial/documentation views produce `READ_DOCUMENTATION`, and Run or Submit requests produce `BROWSER_TESTING`. `step_labels.jsonl` links each observation to its raw event sequence, timestamp, elapsed time, generic action label, and immutable code state. Fine-grained intent labels and behavior/challenge summaries remain offline annotations rather than guessed collection-time data.

Event uploads are idempotent by event identity. If a browser retries a batch after losing the response, the server accepts any unseen suffix and ignores matching events already stored without creating sequence gaps.

Final Submit attempts are recompiled and checked on the server. Each attempt preserves its semantic test results and links back to the immutable compiler execution. Passing submissions also mark the session manifest with `passed_submission_id` and `passed_at`.

Set `TRACE_STORAGE_DIR` to place traces on a mounted persistent volume:

```bash
TRACE_STORAGE_DIR=/path/to/persistent/traces .venv/bin/python server.py
```

This filesystem format is intentionally object-storage friendly: each event batch and execution is immutable. On serverless hosting, use a persistent volume or replace the filesystem writes with S3/R2 object writes; a function's temporary disk alone is not durable.

## Private trace dashboard

Set a strong administrator key and open `/admin` to browse stored sessions without downloading the volume:

```bash
TRACE_ADMIN_TOKEN='a-long-random-secret' .venv/bin/python server.py
```

The dashboard shows Prolific identifiers, session status, event totals, the ordered browser-event timeline, replayable source snapshots, every compile result and artifact, submissions, and raw stored files. Data APIs require a signed, HTTP-only administrator session cookie. File previews are restricted to the selected session directory and capped at 256 KB. The key must be at least 20 characters and should be configured as a private Railway service variable.

## Test

```bash
.venv/bin/python -m unittest discover -s tests -v
```

## Deploy on Railway

The repository includes a Docker image and Railway health-check configuration. Deploy the repository as one Railway service, attach a volume at `/data`, and expose the generated Railway domain. Runtime traces are written to `/data/traces` through `TRACE_STORAGE_DIR`.

Required service settings:

```text
Volume mount path: /data
Health check: /api/health
TRACE_ADMIN_TOKEN: a strong random secret with at least 20 characters
```

Railway supplies the public `PORT` automatically. The container binds to `0.0.0.0` so the editor, compiler API, and trace store are available from the same origin.

## Launch through Prolific

The app accepts Prolific's `PROLIFIC_PID`, `STUDY_ID`, and `SESSION_ID` URL parameters and saves them with the trace. When a participant follows a static link from an external survey, the editor requires their Prolific ID before it starts the trace or enables the study controls. Set the study-specific Railway variable below so a passing submission can return the participant to Prolific:

```text
PROLIFIC_COMPLETION_URL=https://app.prolific.com/submissions/complete?cc=YOUR_CODE
```

See [PROLIFIC_SETUP.md](PROLIFIC_SETUP.md) for the external study URL, completion-path setup, task definition, and pilot checklist.

## Current safety boundary

Compilation runs in a temporary subprocess with time, file-size, and file-descriptor limits. This is appropriate for local development and controlled testing. Before accepting untrusted public submissions, move `compiler_worker.py` into a dedicated sandbox such as Modal Sandbox, gVisor, or Firecracker and disable outbound networking.

## Four-language runtime support

Install the pinned JavaScript runtimes and build the isolated Idyll preview before starting the Python server:

```bash
npm ci --ignore-scripts
npm run build
.venv/bin/python server.py
```

The local language selector now includes KnitScript, Vega-Lite, Idyll and Penrose. Production language assignment remains URL-based. Direct preview URLs:

- KnitScript: `/?preview=1&task=stockinette-swatch-v1`
- Vega-Lite: `/?preview=1&task=vega-lite-sales-v1`
- Idyll: `/?preview=1&task=idyll-playground-v1`
- Penrose: `/?preview=1&task=penrose-playground-v1`

Idyll uses the official compiler and a browser runtime with selected built-in controls, variables and reactive expressions. Its preview runs in an opaque sandbox without network access. Custom components, front matter and dataset imports are excluded. Compilation checks markup; JavaScript expression failures are reported by the browser preview. As with other browser programming environments, nonterminating expressions can stall the preview; this is intended for controlled research use.

Penrose accepts Substance programs against the versioned `static/penrose-domain.dsl` and `static/penrose-style.sty`. They support sets, points, containment, intersection, disjointness and membership. The official engine compiles and optimizes diagrams with a fixed variation, rendering SVG inside a script-free sandbox. Successful rendering is not proof that every visual constraint is satisfied.

Both new languages are Run-only previews: formal task checks and Submit are deliberately unavailable. Existing KnitScript and Vega-Lite tasks retain their current checks and limitations. All runners share concurrency bounds, and each additional-language subprocess has a 25-second timeout and a Node heap limit. Docker installs pinned dependencies and builds the preview automatically.

Runtime checks:

```bash
node tests/idyll_runtime.cjs
node tests/penrose_runtime.cjs
.venv/bin/python -m unittest tests.test_dsl_runtime -v
```

Dependency audit note: the pinned stable Idyll packages retain upstream advisories in legacy transitive packages (including charting, syntax-highlighting, CSV and tooltip dependencies). The preview bundles only selected components; CSV imports and networking are disabled. This does not constitute a clean dependency audit or a production sandbox review. Container changes have not been build-tested when Docker is unavailable.

For the full browser smoke test, start the app and run `STUDIO_URL=http://127.0.0.1:8000 node tests/idyll_browser.cjs` with Node 22+ and Chrome installed (`CHROME_BIN` overrides the executable path). It checks real reactive updates, preview isolation, diagnostics, onboarding, and Idyll/Penrose Run from the editor.

## DSL paths and task sets

Use `/knitscript`, `/vega-lite`, `/idyll`, or `/penrose` to assign a language and its three-task set. A trailing slash is also accepted. Each path opens Task 01 by default; `?task=<catalog-task-id>` selects another task within that DSL. For example, `/penrose?task=penrose-points-v1&preview=1` opens the points-and-sets task. Unknown or cross-DSL task query values fall back to that path's first task, never another language.

The task selector switches between the three tasks within the assigned DSL. The language selector is locked on these paths, including local previews. Each task has an independent draft and telemetry session; returning to a task restores its draft. Navigation preserves Prolific ID parameters and waits for pending events to save. Without `preview=1`, the existing participant identity gate remains in place.

`study_tasks.py` is the shared task catalog, exposed through `/api/task-catalog` and `/task-catalog.js`. New catalog sessions and Run requests include both `task_id` and `dsl`; the server rejects mismatches. These tasks are Run-only pending formal task checkers. Legacy root `/?task=...` links and their existing submission behavior are preserved.

For the new Vega-Lite tasks, the runtime supports aggregation, transforms and composed views with inline data or `/sales-data.json`. Supplied data is normalized to inline values; other data URLs and external resources are not loaded. Legacy Vega-Lite task restrictions remain unchanged.

Verify path assignment, task navigation, independent drafts, participant query preservation and actual previews with `STUDIO_URL=http://127.0.0.1:8000 node tests/dsl_paths_browser.cjs` while the server is running. Chrome and Node 22+ are required; `CHROME_BIN` overrides the Chrome executable.
