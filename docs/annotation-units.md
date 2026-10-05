# Annotation edit units

The studio derives `syntactic-unit-v1` in the browser from the original dataset. It never rewrites stored traces or original annotations. Rule detection runs on the original steps, then maps results to the derived steps, retaining detection IDs and review decisions.

Adjacent local editor edits are accumulated until a statement or structural boundary, a cursor-region change, a five-second gap, or a non-edit event. Strings and comments protect embedded delimiters. Insertions and deletions containing multiple statements are decomposed. A complete inserted block starts with an empty frame, followed by its contents. Incomplete fragments and ambiguous compound replacements are explicitly exposed for inspection. This is delimiter-based segmentation, not a full KnitScript parser.

Each derived step retains `rawStepIndices`, `sourceSteps`, original steps, source before/after, action and unit type. Decomposed paste states are synthetic; they must not be interpreted as observed intermediate code or participant decisions. A shared raw event can map to several units. Its annotations are carried to all those units with ambiguous provenance, not assigned an invented token location.

Original event details are available through the Original events tab. JSON exports include original steps, original annotations, unit mappings and unit annotations. Original localStorage keys remain untouched; the derived view uses a versioned separate key and migrates prior annotations by original step index. Legacy imports are mapped the same way. Rebuilding with a different algorithm requires a new granularity version and a corresponding migration.

Verification: `node tests/test_annotation_units.cjs`, `node tests/test_annotation_session.cjs`, `node tests/test_annotation_rules.cjs`, and `.venv/bin/python -m unittest discover -s tests -p 'test_annotation_fixture.py' -v`.
