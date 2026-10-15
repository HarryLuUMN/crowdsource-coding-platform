# Semantic Step Processor: first implementation

## Current method: v3 local recognition

V3 adds explicitly labeled lexical candidates for incomplete assignments,
instruction forms and supported structural headers. Candidate recognition uses
native terminal tokens and a small documented prefix policy: identifier followed
by `=`, a native `needle_instruction` word, or with/for/while/def/in. It does not
certify a candidate's full syntax. A line beginning with `#` is retained as a
`foreign_annotation` candidate, not discarded as valid KnitScript layout.

At bracket depth zero, new assignment/header lines delimit previous incomplete
fragments; foreign annotation candidates end at a newline. Missing punctuation
is never inserted. Units expose `recognition` as `native_grammar` or
`lexical_candidate`; E6 returns `beforeUnit` as well as the updated `unit` so a
candidate-to-grammar repair does not hide its weaker starting evidence.

### Third read-only pilot: 6638e

Run `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python scripts/test_semantic_step_processor.py`.
The runner prints results only, checks raw-event coverage and verifies annotation
JSON hashes. It does not save or replace any dataset.

| Curated 31 transitions | v1 | v2 | v3 |
| --- | --- | --- | --- |
| Unresolved | 23 | 17 | 6 |
| Compound | 6 | 9 | 11 |
| Local modification | 2 | 3 | 8 |
| Local deletion | 0 | 0 | 3 |
| Assignment insertion | 0 | 0 | 1 |
| Layout only | 0 | 2 | 2 |

V3 groups 123 raw events into 89 records: 58 non-edit events, 6 unresolved groups,
6 local modifications, 6 local deletions, 7 brace additions, 3 layout-only groups,
2 compound edits and 1 assignment insertion. Counts include lexical candidates;
they are not verified recognition-accuracy scores or evidence of program validity.

Steps 29/31 now identify carrier-header revisions; 39–41 identify instruction
argument changes, including malformed-to-recognized transitions. Step 7 changes
two assignment terminators and is compound. Steps 9/10 delete foreign annotation
candidates. Steps 33/34 insert/remove an incomplete assignment candidate.

Unresolved curated steps remain 2, 4, 5, 23, 25 and 35: foreign code, broad mixed
replacements and disjoint text alignment still need further handling. No change
was made to the UI, original sources, raw events or annotation labels.

### Local recognition introduced in v2

The processor no longer uses complete-program parse success as an eligibility
gate. It identifies local units independently of surrounding broken syntax.

1. Lex source with native grammar terminal recognizers. Use longest match, then
   native priority, with a stable terminal-name tie break. Exclude layout-only
   catch-all terminals from code recognition. Unknown characters remain tokens.
   This is an analytical lexer policy, not parglare's contextual lexer.
2. Split candidate fragments at semicolons and braces outside strings, comments,
   parentheses and brackets. A newline after a colon separates an unfinished
   block header from its body. Other incomplete fragments remain explicit.
3. Recognize each fragment using native statement or instruction productions.
   Recognize headers using a derived start production: native header syntax up
   to the colon, without requiring a block body. Header alternatives cover with,
   for, while, def and carriage direction; if/elif/else/try headers are not yet
   supported by this adapter. No source bytes are inserted to make parsing pass.
4. Pair observed braces and recognized headers to locate frames, including empty
   frames. This identifies structure, not grammatical validity of a whole program.
5. Compare locally recognized units. Unknown fragments elsewhere do not block
   a known local modification. E8 identifies an added brace, E9 an added header,
   and E10 an added empty frame. E1 now means unresolved local fragments, not
   failed whole-program parsing. E6 also accepts header-local changes.
6. Group edits targeting the same identified unit. If no unit is available yet,
   continue unfinished typing only while edits stay within the previous changed
   region (with one-character boundary tolerance). Runs and the five-second gap
   remain hard boundaries. This fallback uses edit location, not parse success.

The compatibility field `parse.before/after` now indicates whether all local
fragments were recognized. It is not a whole-program syntax validation result.
`diagnostics` lists unidentified fragment ranges and text. Neither field decides
whether recognized neighboring units are usable.

### Second read-only pilot: 6638e

All annotation dataset JSON hashes remained identical. All 123 raw events were
covered. The same inputs and comparison protocol as the v1 pilot were used.

| Measure | v1 | v2 |
| --- | --- | --- |
| Raw output records (includes non-edit events) | 76 | 96 |
| Raw non-edit records | 58 | 58 |
| Raw edit-group records | 18 | 38 |
| Raw edit classifications | 16 unresolved, 1 compound, 1 no-net-change | 20 unresolved, 6 layout-only, 7 brace additions, 3 deletions, 1 compound, 1 local modification |
| Curated 31 transitions | 23 unresolved, 6 compound, 2 local modifications | 17 unresolved, 9 compound, 2 layout-only, 3 local modifications |

Curated examples: steps 16/18 are now layout-only; step 27 is a local carrier-header
change; steps 51/53 remain local assignment changes. Steps 12–14 add multiple
brace boundaries and remain compound. Missing terminators, invalid comments and
unsupported malformed fragments still limit recognition. More output records
do not imply more valid semantic steps; the grouping policy also changed.

The input datasets and UI remain unchanged. Recognition accuracy has not been
established by a full manually labeled benchmark. Fragment recovery, multiline
incomplete statements and interpolated strings need further evaluation.

## Historical v1 method and first pilot

The sections below describe the original strict-parser baseline, not the current
local-recognition implementation. They are retained for the experimental comparison.

## 中文阅读指南

代码只保留简短英文注释，完整方法和使用说明放在本文件。

三个主要方法：

- `analyze(source)`：看一份代码有哪些语法单元，以及能否解析。
- `compare(before, after)`：比较两份代码，说明改了什么、依据哪条规则。
- `process_events(events)`：把同一个语法单元的连续编辑合为一步。

处理顺序：原始事件重建代码 → 原生语法解析 → 比较变化 → 判断单元类型 → 合并连续编辑。

返回结果中，`unitType` 是变化类别，`rule` 是规则编号，`reason` 是判定理由，
`unit` 是语法类型和代码位置，`rawStepIndices` 指向原始事件。

几个容易误解的地方：

- 空代码作为比较起点，不代表 grammar 允许空程序。
- 比较词法符号时不计空白和合法注释，因此能识别仅格式变化。
- 记录 grammar 哈希，便于发现同版本包里的语法文件是否被改过。
- 代码位置按 Python 字符编号，包含起点、不包含终点；与浏览器 UTF-16 编号不同。
- 重复语句可能让文本对齐有歧义；这里不是完整的 AST 节点匹配算法。
- 快照只能说明两份代码有差别，不能还原参与者的输入过程。

下面保留完整的英文方法定义、规则表、使用示例和限制，供复现与论文写作参考。

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

## Read-only pilot: Trace 6638e

The existing processor was exercised against `s4-units.json` in memory, without
regenerating any dataset. SHA-256 checks of all `annotation_data/*.json` before
and after the run were identical. Every raw input event remained covered.

Two separate inputs were evaluated; their results must not be combined:

| Input | Output |
| --- | --- |
| 123 genuine raw events, grouped with `process_events` | 76 records: 58 non-edit events, 16 unresolved syntax groups, 1 compound edit, 1 no-net-change group |
| 31 changing source transitions in the curated view, classified individually with `compare` | 23 unresolved syntax, 6 compound edits, 2 local modifications |

The 76 records are not 76 confirmed semantic edit steps. Reading and run events
remain separate, and most edit groups lack a supported single-unit classification.

Examples from the curated comparisons (one-based existing step numbers):

| Step | Observed difference | Processor result |
| --- | --- | --- |
| 51 | `width = 10;` to `width = 11;` | E6, local modification within `declare_variable`, range [0, 11) |
| 53 | `width = 11;` to `width = 10;` | E6, same assignment-unit classification |
| 55 | `knit` to `tuck` plus securing-loop bound change | E7, compound edit; not forced into one unit |

These later transitions retain snapshot-difference provenance, not keyboard-event
provenance. The pilot demonstrates substantial coverage limits: requiring both
endpoints to parse loses most early error-repair transitions. A partial-parse or
token-level fallback needs its own explicit definition and tests before this
processor can replace the existing pipeline. No fallback was added in this pilot.

## Verification

Run `.venv/bin/python -m unittest discover -s tests -p 'test_semantic_step_processor.py'`.
Tests cover native comment/string handling, grammar-node classification, invalid
endpoints, multi-unit changes, instruction spans, grouping boundaries and snapshot
provenance. Existing datasets are not rewritten by these tests.
