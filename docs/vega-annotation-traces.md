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
views; they are ready for annotation, not pre-annotated.

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
