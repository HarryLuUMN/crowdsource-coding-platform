# Semantic Step Processing

本文件说明当前 JavaScript 流程。入口是 `buildUnitDataset()`，实现位于
`static/annotation-units.js`。Python parser processor 是独立实验，不是本流程。

## 1. Semantic step 是什么？

在这里，semantic step 是**用于分析的、可追溯到原始事件的步骤**。
它不是一次按键，也不代表参与者的一次想法。

编辑步骤的目标粒度是一个局部代码单元的增加、删除或内部修改：

- 一条声明或赋值。
- 一个空结构框架。
- 已有框架内的一条操作或表达式。
- 已有代码中的一次局部替换。
- 一个局部单元的删除。

当前实现用明确的文本边界近似这些单元，不声称进行了完整语法分析。
不能满足单元粒度的变化会保留为复合修改或未完成片段，而不是静默丢弃。

阅读步骤和运行等事件也出现在同一条时间线上，但不是编辑单元。

### Operational definition for the method section

An edit episode is an ordered group of adjacent source-changing editor events
bounded by the explicit temporal, positional and delimiter rules below. Its net
change is the smallest enclosing text replacement between the episode's observed
endpoints. For pure insertions and deletions, delimiter-based segmentation yields
unit-level analytical steps. Replacements remain one step and are marked compound
when either side contains multiple segments. Every output retains its source
events; decomposed intermediate states are analytical constructions, not observed
participant actions. Incomplete and compound outputs are not certified single
syntactic units.

这个定义描述当前算法实际做的事。它不证明语义等价、行为变化或认知意图。

## 2. 先确定一组连续编辑

`startsNewEditGroup(previous, step)` 按以下顺序判断是否分组：

1. 当前事件不是普通 `editor.edit`：结束前一组。
2. 与前一事件间隔超过 5000 ms：结束前一组。
3. 当前修改起点在前一次修改起点之前：结束前一组。
4. 当前修改起点超出前一次插入区域末尾加一个字符：结束前一组。
5. 前一次插入已到达 `;`、`{` 或 `}` 边界：结束前一组。

这些条件都不满足，才累积到当前组。位置规则比较的是相邻原始事件，不是
整组首尾。5000 ms 是显式的分析参数选择，不是语言本身的规则。

加入事件后，paste 等非普通编辑会立即结束当前组；一次修改出现多个分段
也会立即结束。运行、其他非编辑事件、代码未变化的事件同样结束当前组。

## 3. 找出组内的净变化

`unitChange(before, after)` 去掉相同的前缀和后缀，返回中间的替换范围。

例如 `width = 10; → width = 11;` 的净变化是 `0 → 1`。
多处独立修改可能被这个范围包在一起；它不是多区间 diff 或 AST diff。

若组内修改最终恢复原样，保留 `reverted_edit` 和原始事件。

## 4. 根据边界拆分和分类

`unitSegments(text)` 遇到外层 `;`、`{`、`}` 就切分，并保留分隔符。
字符串和 `()`、`[]` 内的分隔符不会切分。空白和原始文本不会删除。

`classifyEditUnit()` 的判定顺序：

| 情况 | unitType | 含义 |
| --- | --- | --- |
| 替换任一侧有多个分段 | unresolved_compound_edit | 未拆开的复合替换 |
| 替换两侧至多各一个分段 | small_span | 局部替换候选，不保证只有一个 token |
| 插入开框架片段且后面有独立闭括号片段 | empty_frame | 先构造一个空框架 |
| 片段以 `{` 结尾或只有 `}` | frame_boundary | 框架边界 |
| 片段不以分号结尾 | incomplete_unit | 未完成片段 |
| 分号结尾且匹配 `global? identifier =` 前缀 | assignment | 赋值候选 |
| 其他分号结尾片段 | operation | 操作候选 |

赋值前缀是正则近似；operation 也不是经过 grammar 验证的语句。
删除片段同样按文本形状分类，具体删除行为由 `action: delete` 表示。

## 5. 构建代码状态，但不捏造输入历史

`appendEditUnits()` 处理上述净变化：

- 插入或删除：按分段依次构建分析状态。
- 替换：保留一次替换，不猜测内部编辑次序。
- 插入完整 block：先生成空框架，再填入内部片段。
- 分解后仍未恢复真实最终代码：补一个带说明的 `incomplete_unit`。

拆分出的状态保留 `synthetic` 标记，多个单元可以对应同一个 paste。
这种顺序只是算法的分析顺序，不是参与者实际操作顺序。
synthetic 不表示代码正确，empty_frame 也不表示 KnitScript 接受空 block。

## 6. Reading 和其他事件

`appendReadingSequence()` 把相邻、带 `reading` 证据的事件合为一步。
没有时间间隔上限；任何不带 reading 的事件都会结束序列。
文档路径或标题改变不自动分组，因此一个序列可以包含多个文档。

保存所有原事件、起止时间、位置和可见内容。可见不等于确实阅读。
运行等其他事件原样保留，不经过代码单元切分。

## 7. 原始证据和标注

每步保存 `rawStepIndices`、`rawSteps` 和 `sourceSteps`。
`mapRawAnnotations()` 按原事件映射标签并取并集。一条事件拆成多个单元时，
标签会复制到各单元；provenance 会标记歧义，而不是编造精确的 token 标注。

## 8. 已知限制与本次修改范围

- 为保持结果兼容，扫描器仍把 `#` 当行注释处理；这不等于原生 KnitScript
  的注释规则。`//` 和 `/* */` 没有专门的注释保护。更改需单独评估和迁移。
- 分组依赖时间和编辑位置；无法推断意图。
- `small_span` 不保证单 token；赋值和操作类型也只是候选。
- 框架配对使用后续闭括号片段的启发式，不是完整嵌套语法匹配。
- `s4 / 5f427 / 691de` 的现有 semantic view 来自旧 curated steps，不能声称
  它们由这个算法统一生成。Raw view 则保留真实原始事件。
- 本次只重构可读性，未改变规则、版本号或输出结构，也未重建任何数据集。

## 9. 从哪里开始读代码？

先看 `buildUnitDataset()` 的主流程，再分别读：

1. `startsNewEditGroup()`：为什么在这里分组？
2. `appendEditUnits()`：这一组如何变成分析步骤？
3. `classifyEditUnit()`：为什么属于这个类别？
4. `appendReadingSequence()`：哪些阅读事件被合在一起？
5. `mapRawAnnotations()`：原标签如何保留下来？

验证：`node tests/test_annotation_units.cjs`。测试覆盖六条 trace 的输出摘要，
用于锁定这次重构前后结果完全一致。修改数据 fixture 或标签后需显式复核摘要。
