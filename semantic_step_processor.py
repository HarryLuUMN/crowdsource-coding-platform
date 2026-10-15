"""Group edits using KnitScript syntax. See docs/semantic-step-processor.md."""

from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from hashlib import sha256
from importlib.metadata import version
from importlib.resources import files
import re

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
    recognition: str = "native_grammar"


class SemanticStepProcessor:
    """Identify syntax units and group edits without executing code."""

    METHOD_VERSION = "grammar-grounded-v3-local"

    def __init__(self, max_gap_ms=5000):
        grammar_text = files("knit_script.knit_script_interpreter").joinpath("knit_script.pg").read_text()
        self.parser = Parser(
            Grammar.from_string(grammar_text, ignore_case=True),
            build_tree=True, call_actions_during_tree_build=False,
        )
        instruction_grammar = grammar_text.replace("S: program;", "S: instruction_assignment;")
        self.instruction_parser = Parser(Grammar.from_string(instruction_grammar, ignore_case=True), build_tree=True)
        headers = []
        for name in ["with_statement", "for_each_statement", "while_statement", "function_declaration"]:
            body = re.search(rf"\n{name}: (.*?);", grammar_text, re.S).group(1)
            headers.append(body.split("colon", 1)[0] + "colon")
        headers.append('"in" pass_dir=expression "direction" colon')
        header_grammar = grammar_text.replace("S: program;", "S: analysis_header;")
        header_grammar = header_grammar.replace("\nterminals", "\nanalysis_header: " + " | ".join(headers) + ";\nterminals")
        self.header_parser = Parser(Grammar.from_string(header_grammar, ignore_case=True), build_tree=True)
        instruction_rule = re.search(r"\nneedle_instruction: (.*?);", grammar_text, re.S).group(1)
        self.instruction_words = set(re.findall(r'"([a-z]+)"', instruction_rule))
        self.terminals = [terminal for name, terminal in self.parser.grammar.terminals.items()
                          if name not in {"EMPTY", "STOP", "KEYWORD", "NotComment", "f_string_text", "f_quote", "quote"}]
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
        """Recognize local units even when surrounding code is unfinished."""
        tokens = self.lex(source)
        units, fragments = [], []
        start, depth = None, 0

        def recognize(end):
            nonlocal start
            if start is None:
                return
            text = source[start:end]
            found = False
            for parser, header in [(self.parser, False), (self.instruction_parser, False), (self.header_parser, True)]:
                try:
                    tree = parser.parse(text)
                except GrammarSyntaxError:
                    continue
                if header:
                    first = text.split()[0].lower()
                    name = {"with": "with_statement", "for": "for_each_statement", "while": "while_statement",
                            "def": "function_declaration", "in": "carriage_pass"}[first]
                    units.append(SyntaxUnit(name + "_header", start, end, False))
                else:
                    def visit(node):
                        children = getattr(node, "children", [])
                        if node.symbol.name in WRAPPERS and children:
                            concrete = node if node.symbol.name == "instruction_assignment" else children[0]
                            units.append(SyntaxUnit(concrete.symbol.name, start + node.start_position,
                                                    start + node.end_position, concrete.symbol.name in STRUCTURES))
                        for child in children:
                            visit(child)
                    visit(tree)
                found = True
                break
            if not found:
                local_tokens = self.lex(text)
                words = [t["text"].lower() for t in local_tokens]
                production = None
                if len(words) >= 2 and local_tokens[0]["kind"] == "identifier" and words[1] == "=":
                    production = "declare_variable"
                elif words and words[0] in self.instruction_words:
                    production = "instruction_assignment"
                elif words and words[0] in {"with", "for", "while", "def", "in"}:
                    production = {"with": "with_statement", "for": "for_each_statement", "while": "while_statement",
                                  "def": "function_declaration", "in": "carriage_pass"}[words[0]] + "_header"
                elif text.startswith("#"):
                    production = "foreign_annotation"
                if production:
                    units.append(SyntaxUnit(production, start, end, False, "lexical_candidate"))
                fragments.append({"start": start, "end": end, "text": text,
                                  "candidate": production})
            start = None

        previous_end = 0
        for token in tokens:
            if depth == 0 and "\n" in source[previous_end:token["start"]] and start is not None:
                # End only recognized lines; incomplete multiline calls stay together.
                text = source[start:previous_end]
                next_word = token["text"].lower()
                next_assignment = re.match(r"[a-zA-Z_]\w*\s*=", source[token["start"]:])
                if text.rstrip().endswith(":") or text.startswith("#") or next_assignment or next_word in {"with", "for", "while", "def", "in"}:
                    recognize(previous_end)
            if token["text"] in {"{", "}"} and depth == 0:
                recognize(token["start"])
                units.append(SyntaxUnit("frame_boundary", token["start"], token["end"], False))
            else:
                if start is None:
                    start = token["start"]
                if token["text"] in {"(", "["}:
                    depth += 1
                elif token["text"] in {")", "]"}:
                    depth = max(0, depth - 1)
                if token["text"] == ";" and depth == 0:
                    recognize(token["end"])
            previous_end = token["end"]
        recognize(previous_end)
        stack = []
        for token in tokens:
            if token["text"] == "{":
                header = next((u for u in reversed(units) if u.production.endswith("_header")
                               and u.end <= token["start"] and not source[u.end:token["start"]].strip()), None)
                stack.append((token, header))
            elif token["text"] == "}" and stack:
                opening, header = stack.pop()
                if header:
                    empty = not source[opening["end"]:token["start"]].strip()
                    units.append(SyntaxUnit("empty_frame" if empty else header.production.removesuffix("_header"),
                                            header.start, token["end"], True))
        return {"valid": not fragments, "units": units, "tokens": [t["text"] for t in tokens],
                "fragments": fragments, "diagnostic": fragments or None}

    def lex(self, source):
        """Use native terminal recognizers; preserve unknown characters."""
        tokens, position = [], 0
        while position < len(source):
            if source[position].isspace():
                position += 1
                continue
            if source.startswith("//", position):
                end = source.find("\n", position)
                position = len(source) if end == -1 else end
                continue
            if source.startswith("/*", position):
                end = source.find("*/", position + 2)
                if end != -1:
                    position = end + 2
                    continue
            matches = []
            for terminal in self.terminals:
                value = terminal.recognizer(source, position)
                if value:
                    matches.append((len(value), terminal.prior, terminal.name, value))
            if matches:
                _, _, kind, text = max(matches)
            else:
                kind, text = "unknown", source[position]
            tokens.append({"kind": kind, "text": text, "start": position, "end": position + len(text)})
            position += len(text)
        return tokens

    @staticmethod
    def _covering(units, start, end):
        # A shared loop does not make edits to different statements local.
        return [unit for unit in units if not unit.structural
                and unit.start <= start and end <= unit.end]

    def compare(self, before, after, evidence="observed_edits"):
        """Classify one change; keep multi-unit edits compound."""
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
        if old["tokens"] == new["tokens"]:
            return decision("non_semantic_edit", "E2", "Grammar tokens are unchanged; only layout differs.")

        # Choose the largest complete unit to avoid counting nested units twice.
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
                        return decision("local_deletion", "E3", "One recognized unit or explicit lexical candidate was removed.", unit)
                    if unit.production == "frame_boundary":
                        return decision("frame_boundary", "E8", "One observed block delimiter was added.", unit)
                    if unit.production.endswith("_header"):
                        return decision("structural_header", "E9", "A native grammar header was identified without requiring its body.", unit)
                    if unit.structural:
                        if unit.production == "empty_frame":
                            return decision("empty_frame", "E10", "A recognized header and empty brace pair were inserted.", unit)
                        return decision("compound_edit", "E4", "A complete structure and its contents were inserted together; no empty-frame history was invented.", unit)
                    kind = "declaration_assignment" if unit.production in DECLARATIONS else "expression_operation"
                    return decision(kind, "E5", "One recognized unit or explicit lexical candidate was inserted.", unit)

        old_start = min(c["before"][0] for c in changes)
        old_end = max(c["before"][1] for c in changes)
        new_start = min(c["after"][0] for c in changes)
        new_end = max(c["after"][1] for c in changes)
        for unit in self._covering(old["units"], old_start, old_end):
            matches = self._covering(new["units"], new_start, new_end)
            for updated in matches:
                if unit.production == updated.production:
                    result["beforeUnit"] = asdict(unit)
                    return decision("small_span_modification", "E6", "All changed spans lie within matching local units; recognition records grammar or candidate evidence.", updated)
        if not old["valid"] or not new["valid"]:
            # Multiple recognized candidates are compound, not a parse failure.
            def identified(parsed, side):
                return all(any(u.start <= c[side][0] and c[side][1] <= u.end
                               for u in parsed["units"] if not u.structural)
                           for c in changes if c[side][0] != c[side][1])
            if identified(old, "before") and identified(new, "after"):
                return decision("compound_edit", "E7", "Changed spans cover multiple recognized units or lexical candidates.")
            return decision("unresolved_fragment", "E1", "Changed fragments lack a recognized local unit; other units remain available.")
        return decision("compound_edit", "E7", "The transition spans more than one local unit.")

    def process_events(self, events, initial_source=""):
        """Group edits to one unit; stop at runs and other non-edit events."""
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
                    if not prior["unit"] and prior["changes"] and extended["changes"]:
                        # Continue unfinished typing only in the same edit region.
                        a, b = prior["changes"][-1]["after"]
                        incremental = self.compare(source, after)["changes"]
                        same_unit = incremental and all(a <= c["before"][0] <= c["before"][1] <= b + 1 for c in incremental)
                    if event.get("elapsedMs", 0) - last.get("elapsedMs", 0) > self.max_gap_ms or (
                        not same_unit
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
