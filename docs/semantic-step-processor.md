# Semantic Step Processor: first implementation

## 中文阅读指南

代码只保留简短注释，完整方法和使用说明放在本文件。

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

## Verification

Run `.venv/bin/python -m unittest discover -s tests -p 'test_semantic_step_processor.py'`.
Tests cover native comment/string handling, grammar-node classification, invalid
endpoints, multi-unit changes, instruction spans, grouping boundaries and snapshot
provenance. Existing datasets are not rewritten by these tests.
