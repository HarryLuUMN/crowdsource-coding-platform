# Semantic Step Processing

This document describes the current JavaScript pipeline. The existing
[Chinese version](semantic-step-processing.md) is retained unchanged.

The entry point is `buildUnitDataset()`. Responsibilities are split across files:

| File | Responsibility |
| --- | --- |
| `static/annotation-units.js` | Main workflow, output dataset, annotation mapping |
| `static/annotation-unit-text.js` | Net text changes and delimiter-based segmentation |
| `static/annotation-unit-edits.js` | Grouping boundaries, classification, and edit replay |
| `static/annotation-unit-reading.js` | Consecutive reading aggregation |

The browser page and dataset builder load the three helper files before the entry
file. The Python parser-based processor is a separate experiment, not this pipeline.

## 1. What is a semantic step?

Here, a semantic step is an **analytical step that can be traced back to recorded
events**. It is neither a keystroke nor a claim about a participant's thought.

The target granularity for an edit step is one local code-unit addition, deletion,
or internal modification:

- One declaration or assignment.
- One empty structural frame.
- One operation or expression inside an existing frame.
- One local replacement within existing code.
- One deletion of a local unit.

The implementation approximates these units using explicit text boundaries; it
does not perform full syntax analysis. Changes that do not meet unit granularity
remain compound edits or incomplete fragments rather than being silently dropped.
Reading and execution events share the timeline but are not edit units.

### Operational definition

An edit episode is an ordered group of adjacent source-changing editor events
bounded by the explicit temporal, positional and delimiter rules below. Its net
change is the smallest enclosing text replacement between the episode's observed
endpoints. For pure insertions and deletions, delimiter-based segmentation yields
unit-level analytical steps. Replacements remain one step and are marked compound
when either side contains multiple segments. Every output retains its source
events; decomposed intermediate states are analytical constructions, not observed
participant actions. Incomplete and compound outputs are not certified single
syntactic units.

This definition describes the algorithm's operations. It does not establish
semantic equivalence, a change in behavior, or cognitive intent.

## 2. Group consecutive edits

`startsNewEditGroup(previous, step)` ends the preceding group when any of these
conditions holds, checked in order:

1. The current event is not an ordinary `editor.edit`.
2. The gap from the preceding event exceeds 5000 ms.
3. The current change starts before the preceding change's start.
4. The current change starts beyond the preceding inserted region plus one character.
5. The preceding insertion has reached a `;`, `{`, or `}` boundary.

Otherwise, the current edit joins the pending group. Position checks compare
adjacent raw events, not the endpoints of the whole group. The 5000 ms threshold
is an explicit analytical choice, not a language rule.

After an event is added, nonordinary edits such as paste are emitted immediately.
A change containing multiple segments is also emitted immediately. Runs, other
non-edit events, and events without source changes end the pending group.

## 3. Extract the net change

`unitChange(before, after)` removes matching prefixes and suffixes and returns
the remaining replacement range.

For example, `width = 10;` becoming `width = 11;` yields `0` replaced by `1`.
Several disjoint edits can fall inside the enclosing range: this is not a
multi-range diff or an AST diff.

When an episode returns to its original source, a `reverted_edit` retains the
original events rather than treating the episode as if nothing happened.

## 4. Segment and classify the change

`unitSegments(text)` splits at outer `;`, `{`, and `}` delimiters and retains each
delimiter. Delimiters inside strings, parentheses, or square brackets do not split
the text. Whitespace and original content are preserved.

`classifyEditUnit()` applies the following ordered rules:

| Condition | unitType | Interpretation |
| --- | --- | --- |
| Either replacement side has multiple segments | unresolved_compound_edit | Compound replacement retained without decomposition |
| Each replacement side has at most one segment | small_span | Local replacement candidate; not necessarily one token |
| Inserted opening-frame segment has a later standalone closing-brace segment | empty_frame | Construct an empty frame first |
| Segment ends in `{` or consists of `}` | frame_boundary | Structural boundary |
| Segment does not end in a semicolon | incomplete_unit | Unfinished fragment |
| Semicolon-terminated segment matches an optional `global` followed by an identifier and `=` | assignment | Assignment candidate |
| Other semicolon-terminated segment | operation | Operation candidate |

Assignment recognition is a regular-expression approximation. An operation is
not a grammar-validated statement. Deleted pieces are classified by the same text
shape; `action: delete` records that the unit was removed.

## 5. Build analytical states without inventing observed history

`appendEditUnits()` handles the episode's net change:

- Insertions and deletions: replay segments into analytical states.
- Replacements: retain one transition without guessing internal edit order.
- Complete block insertions: construct an empty frame, then insert its contents.
- Unresolved replay remainder: append an `incomplete_unit` restoring the recorded endpoint.

Decomposed steps retain the `synthetic` flag. Multiple units can originate from a
single paste. Their sequence is the algorithm's analytical order, not the
participant's observed input order. `synthetic` does not mean valid code, and
`empty_frame` does not mean KnitScript accepts an empty block.

The edit helpers have separate responsibilities:

- `appendEditUnits()`: plan segments and coordinate replay.
- `applyEditPiece()`: update the source and insertion offset.
- `createEditStep()`: assemble a step and its evidence.
- `appendRevertedEdit()`: preserve editing that returns to the starting source.
- `appendEditRemainder()`: preserve the actual final source.

The replay `cursor` stores the offset, current source, and count of synthetic
closing braces. Synthetic states exist only in the returned analytical output;
they are not written back into the original trace.

## 6. Reading and other events

`appendReadingSequence()` combines adjacent events carrying `reading` evidence.
There is no time-gap limit. Any event without reading evidence ends the sequence.
Changing document paths or titles does not automatically split it, so one sequence
may span multiple documents.

The sequence retains all source events, start/end times, locations, and visible
content. Visibility is not proof of reading. Other events, including runs, remain
separate and do not undergo code-unit segmentation.

## 7. Evidence and annotations

Each step retains `rawStepIndices`, `rawSteps`, and `sourceSteps`.
`mapRawAnnotations()` unions labels from the corresponding original events.
When one event produces several units, its labels can appear on each unit;
provenance records the ambiguity instead of inventing a precise token assignment.

## 8. Limitations and scope of the refactor

- For output compatibility, the scanner still treats `#` as a line comment.
  This is not the native KnitScript comment rule. `//` and `/* */` have no dedicated
  comment protection. Changing this requires separate evaluation and migration.
- Grouping relies on elapsed time and edit positions; it cannot infer intent.
- `small_span` does not guarantee a single token. Assignment and operation types
  are candidates rather than verified syntax categories.
- Frame pairing uses a later closing-brace segment as a heuristic, not full nested
  syntax matching.
- Existing semantic views for `s4`, `5f427`, and `691de` use earlier curated steps.
  They must not be described as uniformly generated by this algorithm. Their raw
  views retain genuine recorded events.
- The readability refactor changed neither rules, granularity versions, nor output
  structure. No dataset was regenerated.

## 9. Suggested reading order and verification

Start with `buildUnitDataset()`, then read:

1. `startsNewEditGroup()`: why does an episode end here?
2. `appendEditUnits()`: how does an episode become analytical steps?
3. `classifyEditUnit()`: why does a piece receive this category?
4. `appendReadingSequence()`: which reading events are combined?
5. `mapRawAnnotations()`: how are original labels retained?

Run `node tests/test_annotation_units.cjs`. The tests compare output digests for
six traces to preserve pre-refactor behavior. Changes to dataset fixtures or
labels require explicit review of those digests.
