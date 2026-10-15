# Vega-Lite annotation traces

Two completed participant sessions are available in Annotation Studio:

| Trace key | Session | Raw events | Legacy steps |
| --- | --- | --- | --- |
| 5e219 | d7438308-77d5-47c3-8d59-a8283bc8a14a | 1050 | 186 |
| 5f67b | 2326a06f-8ef5-4840-8172-bf99abb992c9 | 2176 | 406 |

Open `/annotation?trace=5e219` or `/annotation?trace=5f67b`.
Both sessions have a recorded end event, contiguous client events, and a passed
6/6 submission. Raw events, code states and recorded run results are retained.
Semantic and raw views share manual labels. Local Save is available; hosted
viewers remain read-only.

The datasets were built by `scripts/build_vega_annotation_units.cjs` using the
existing `buildSessionDataset` and `buildUnitDataset` functions without changing
their segmentation rules. This delimiter-based process is not a JSON parser;
synthetic intermediate states may be invalid JSON and must not be interpreted as
observed edits. Neither the Python parser experiment nor the property detector
was applied. Only the general patterns/errors codebook is included. Existing
KnitScript rule suggestions are disabled for these Vega-Lite datasets in both
views. A subsequent first-pass run of `property_rule_detector.py` has now applied
supported general-property findings. This does not enable the old KnitScript
rule engine or constitute manual verification.

## First-pass automatic labels

Detection ran on genuine raw events, not synthetic unit steps. Findings were
mapped back to the existing semantic view without rebuilding source states.
Opening reading-series labels cover the corresponding reading groups; other
properties use the final matching semantic step of the raw evidence. Original
manual labels and review decisions are preserved. Candidate/unknown suggestions
would remain pending, not confirmed annotations.

| Trace | Detector findings | Labeled semantic steps | Properties |
| --- | --- | --- | --- |
| 5e219 | 5 supported | 6 | Opening reading series; 4 wrong-output evaluations |
| 5f67b | 30 supported | 31 | Opening reading series; delete/repaste; 28 wrong-output evaluations |

Each reading series maps to two existing reading groups, so labeled-step counts
exceed finding counts. The raw reports are `annotation_data/5e219-properties.json`
and `annotation_data/5f67b-properties.json`. Both datasets retain the report and
coverage metadata under `automaticLabeling`. No candidate findings were produced
in this run. Code/view counts and all raw evidence remain unchanged.

Only 7 and 49 unique results are represented in event telemetry, compared with
8 and 50 saved server executions. The detector uses recorded result events, not
invented evaluations. Two and twenty failure events respectively lack detailed
messages. Existing rules also use KnitScript-oriented local-unit recognition,
so absent labels are not proof that the corresponding property never occurred.
Saved server diagnostics were inspected but were not added to detector inputs or
used to manually supplement this pass.

To reproduce proposals, run `scripts/label_vega_traces.py` without arguments.
Use `--apply` to save them, or `--report-directory annotation_data --apply` to apply
the stored reports. Before saving, the script creates an ignored `.backups` copy.

For reproduction, run the builder with a server base URL and optional configured
Railway CLI path. It uses existing administrator credentials without printing or
saving them, verifies both completed sessions, event counts, event coverage and
final source equality, then writes the two outputs. It refuses to overwrite any
existing dataset so that manual annotations cannot be lost by regeneration.

Verification:

```sh
node tests/test_vega_annotation.cjs
.venv/bin/python -m unittest tests.test_vega_annotation_api -v
```
