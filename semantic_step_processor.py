"""按 KnitScript 语法划分编辑步骤。完整说明见 docs/semantic-step-processor.md。"""

from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from hashlib import sha256
from importlib.metadata import version
from importlib.resources import files

from parglare import Grammar, Parser
from parglare.exceptions import SyntaxError as GrammarSyntaxError


STRUCTURES = frozenset({
    "code_block", "if_statement", "while_statement", "for_each_statement",
    "with_statement", "carriage_pass", "function_declaration", "try_catch",
})
DECLARATIONS = frozenset({"declare_variable", "declare_global"})
WRAPPERS = frozenset({"statement", "instruction_assignment"})


@dataclass(frozen=True)
class SyntaxUnit:
    production: str
    start: int
    end: int
    structural: bool


class SemanticStepProcessor:
    """识别语法单元，再按规则合并编辑事件；不执行参与者代码。"""

    METHOD_VERSION = "grammar-grounded-v1"

    def __init__(self, max_gap_ms=5000):
        grammar_text = files("knit_script.knit_script_interpreter").joinpath("knit_script.pg").read_text()
        self.parser = Parser(
            Grammar.from_string(grammar_text, ignore_case=True),
            build_tree=True, call_actions_during_tree_build=False,
        )
        self.max_gap_ms = max_gap_ms
        self.identity = {
            "method": self.METHOD_VERSION,
            "knit_script": version("knit-script"),
            "parglare": version("parglare"),
            "grammar_sha256": sha256(grammar_text.encode()).hexdigest(),
            "offset_encoding": "unicode-code-points",
            "max_gap_ms": max_gap_ms,
        }

    def analyze(self, source):
        """解析代码，返回语法单元、词法符号或错误信息。"""
        if not source.strip():
            return {"valid": True, "units": [], "tokens": [], "diagnostic": None}
        try:
            tree = self.parser.parse(source)
        except GrammarSyntaxError as error:
            return {"valid": False, "units": [], "tokens": [], "diagnostic": str(error)}
        units, tokens = [], []

        def visit(node):
            children = getattr(node, "children", None)
            if children is None:
                tokens.append(source[node.start_position:node.end_position])
                return
            if node.symbol.name in WRAPPERS and children:
                concrete = node if node.symbol.name == "instruction_assignment" else children[0]
                units.append(SyntaxUnit(
                    concrete.symbol.name, node.start_position, node.end_position,
                    concrete.symbol.name in STRUCTURES,
                ))
            for child in children:
                visit(child)

        visit(tree)
        return {"valid": True, "units": units, "tokens": tokens, "diagnostic": None}

    @staticmethod
    def _covering(units, start, end):
        # 只找包含修改的单条语句，不能拿整个循环当作局部修改。
        return [unit for unit in units if not unit.structural
                and unit.start <= start and end <= unit.end]

    def compare(self, before, after, evidence="observed_edits"):
        """比较修改前后代码；无法归入一个单元时，保留为复合修改。"""
        old, new = self.analyze(before), self.analyze(after)
        changes = [
            {"operation": tag, "before": [a, b], "after": [c, d]}
            for tag, a, b, c, d in SequenceMatcher(None, before, after, autojunk=False).get_opcodes()
            if tag != "equal"
        ]
        result = {
            "processor": self.identity, "evidence": evidence,
            "previousSource": before, "source": after, "changes": changes,
            "parse": {"before": old["valid"], "after": new["valid"]},
            "diagnostics": {"before": old["diagnostic"], "after": new["diagnostic"]},
            "unit": None,
        }

        def decision(kind, rule, reason, unit=None):
            return {**result, "unitType": kind, "rule": rule, "reason": reason,
                    "unit": asdict(unit) if unit else None}

        if before == after:
            return decision("no_net_change", "E0", "Observed endpoints are identical; intervening edits are retained.")
        if not old["valid"] or not new["valid"]:
            return decision("unresolved_syntax", "E1", "An endpoint cannot be parsed; no structural repair was inferred.")
        if old["tokens"] == new["tokens"]:
            return decision("non_semantic_edit", "E2", "Grammar tokens are unchanged; only layout differs.")

        # 取完整插入或删除的最大单元，避免重复计算嵌套语句。
        if len(changes) == 1 and changes[0]["operation"] in {"insert", "delete"}:
            change = changes[0]
            inserting = change["operation"] == "insert"
            source, parsed, side = (after, new, "after") if inserting else (before, old, "before")
            start, end = change[side]
            candidates = [u for u in parsed["units"] if start <= u.start and u.end <= end]
            if candidates:
                unit = max(candidates, key=lambda u: u.end - u.start)
                if not source[start:unit.start].strip() and not source[unit.end:end].strip():
                    if not inserting:
                        return decision("local_deletion", "E3", "Exactly one complete grammar unit was removed.", unit)
                    if unit.structural:
                        return decision("compound_edit", "E4", "A complete structure and its contents were inserted together; no empty-frame history was invented.", unit)
                    kind = "declaration_assignment" if unit.production in DECLARATIONS else "expression_operation"
                    return decision(kind, "E5", "Exactly one complete grammar unit was inserted.", unit)

        old_start = min(c["before"][0] for c in changes)
        old_end = max(c["before"][1] for c in changes)
        new_start = min(c["after"][0] for c in changes)
        new_end = max(c["after"][1] for c in changes)
        for unit in self._covering(old["units"], old_start, old_end):
            matches = self._covering(new["units"], new_start, new_end)
            for updated in matches:
                if unit.production == updated.production:
                    return decision("small_span_modification", "E6", "All changed spans lie within one leaf grammar unit on each side.", updated)
        return decision("compound_edit", "E7", "No single leaf grammar unit contains the entire transition.")

    def process_events(self, events, initial_source=""):
        """合并同一单元的连续编辑；遇到运行等事件就结束当前组。"""
        steps, pending = [], []
        source = initial_source

        def flush():
            if pending:
                first, last = pending[0], pending[-1]
                step = self.compare(first[2], last[1]["source"])
                step.update(rawStepIndices=[item[0] for item in pending],
                            rawSteps=[item[1] for item in pending])
                steps.append(step)
                pending.clear()

        for index, event in enumerate(events):
            after = event.get("source", source)
            if event["event"].startswith("editor."):
                if pending:
                    last = pending[-1][1]
                    prior = self.compare(pending[0][2], source)
                    extended = self.compare(pending[0][2], after)
                    same_unit = prior["unit"] and extended["unit"] and (
                        prior["unit"]["start"], prior["unit"]["production"]
                    ) == (extended["unit"]["start"], extended["unit"]["production"])
                    if event.get("elapsedMs", 0) - last.get("elapsedMs", 0) > self.max_gap_ms or (
                        prior["parse"]["after"] and not same_unit
                    ):
                        flush()
                pending.append((index, {**event, "source": after}, source))
            else:
                flush()
                if after != source:
                    steps.append({**self.compare(source, after, evidence="snapshot_difference"),
                                  "rawStepIndices": [index], "rawSteps": [event]})
                steps.append({"unitType": "non_edit_event", "event": event["event"],
                              "source": after, "rawStepIndices": [index], "rawSteps": [event]})
            source = after
        flush()
        return {"processor": self.identity, "rawSteps": events, "steps": steps}
