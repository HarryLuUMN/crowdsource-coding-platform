# Semantic Step Processor: first implementation

## Scope and operational definition

`semantic_step_processor.py` is an independent Python analysis module. It does
not replace the Annotation Studio processor, rebuild fixtures, or modify labels.
No new dependency is introduced: KnitScript and parglare are already required.

A **single-unit semantic edit step** is a maximal adjacent group, under the
grouping policy below, whose observed endpoint difference inserts or removes one
grammar-defined unit, or modifies one existing leaf unit internally. This is an
operational, syntax-grounded definition, not a claim about cognition, semantic
equivalence, or whether a program's behavior actually changes.

The native KnitScript grammar defines the units. Concrete children of `statement`
are declaration/assignment, operation/expression or structural units.
`instruction_assignment` is itself a complete unit: its first expression alone
would omit the needles. Structural productions are enumerated explicitly in
`STRUCTURES`. Parent structural nodes are excluded from local-modification tests
so edits to separate statements cannot be merged just because they share a loop.

## Algorithm

1. Accept normalized events with reconstructed `source`, `event` and `elapsedMs`.
   Raw telemetry replay remains an upstream responsibility.
2. Build a concrete parse tree using the installed grammar and no interpreter
   actions. Record grammar SHA-256 and both package versions. No participant code
   is executed. All ranges are half-open Unicode code-point offsets.
3. Compare adjacent source states using deterministic ordered text alignment.
   Compare native grammar tokens separately to detect layout-only changes.
4. Apply the following rules in order. Each output includes the rule and reason.

| Rule | Decision |
| --- | --- |
| E0 | Identical endpoints: no net change; retain original evidence. |
| E1 | Either endpoint fails parsing: unresolved syntax, never auto-repair. |
| E2 | Equal grammar token sequences: non-semantic layout change. |
| E3 | Pure deletion of exactly one complete unit: local deletion. |
| E4 | Whole structural insertion: compound; do not invent frame-first history. |
| E5 | Pure insertion of exactly one complete leaf: declaration or operation. |
| E6 | Every changed span fits within one leaf unit of the same production on each side: local modification. |
| E7 | Otherwise compound/unresolved; not a single-unit step. |

5. Accumulate consecutive editor events while incomplete or targeting the same
   unit, identified by its start offset and production in the cumulative diff.
   Once a valid grouped endpoint exists, an extension that cannot identify that
   same unit ends the group. Non-editor events and gaps strictly greater than
   5000 ms always end it. These are explicit policy choices, not grammar facts.
6. Preserve raw event indices and payloads. A non-editor source change produces
   a snapshot-difference transition plus the original event. Multiple outputs can
   therefore cite the same event; they are not multiple observed keyboard acts.

## Usage

```python
from semantic_step_processor import SemanticStepProcessor

processor = SemanticStepProcessor()
change = processor.compare("width = 10;", "width = 11;")
assert change["unitType"] == "small_span_modification"
assert change["unit"]["production"] == "declare_variable"
assert change["rule"] == "E6"

dataset = processor.process_events(normalized_events, initial_source="")
```

## Deliberate limitations

- The current native grammar requires nonempty blocks. Empty frames and malformed
  endpoints remain unresolved in v1; structural-header edits are not independently
  classified. Supporting them requires a separately specified partial-parse policy.
- Whole-block paste is compound, not a fabricated sequence of participant actions.
- Text alignment is not AST identity matching. Repeated statements, moves and
  disjoint token edits can be ambiguous. E6 means within one leaf, not necessarily
  one token; evidence includes all changed ranges for inspection.
- Incomplete states separated by a run remain separate unresolved steps. This
  conservative behavior sacrifices coverage rather than inventing valid syntax.
- Reading-sequence aggregation, run-result attachment and annotation migration
  are not implemented here. Existing evidence stays unchanged until a separate
  integration/migration is designed and verified.
- Direct browser use needs explicit Unicode code-point to UTF-16 conversion.
- No throughput benchmark or full six-trace evaluation has yet been performed.

## Verification

Run `.venv/bin/python -m unittest discover -s tests -p 'test_semantic_step_processor.py'`.
Tests cover native comment/string handling, grammar-node classification, invalid
endpoints, multi-unit changes, instruction spans, grouping boundaries and snapshot
provenance. Existing datasets are not rewritten by these tests.
