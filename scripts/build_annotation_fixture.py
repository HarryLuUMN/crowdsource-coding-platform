from __future__ import annotations

import argparse
import json
from pathlib import Path


CODEBOOK = [
    {
        "group": "Programming patterns",
        "codes": [
            {"id": "DOC_FIRST", "short": "Doc first", "label": "Document reading first", "description": "The participant reads the tutorial before any code-writing step."},
            {"id": "INCREMENTAL", "short": "Incremental", "label": "Incremental construction", "description": "The participant evaluates after adding one behavior-affecting statement since the previous evaluation."},
            {"id": "LOCAL_REVISION", "short": "Local revision", "label": "Local revision", "description": "After evaluating, the participant changes less than a full statement and evaluates again."},
            {"id": "LOCAL_AFTER_SYNTAX", "short": "Local: syntax", "label": "Local revision after a syntax error", "description": "A sub-statement revision follows an evaluation with a syntax error."},
            {"id": "LOCAL_AFTER_OUTPUT", "short": "Local: output", "label": "Local revision after wrong output", "description": "A sub-statement revision follows an evaluation with obviously wrong output."},
            {"id": "TRIAL_ERROR", "short": "Trial & error", "label": "Trial-and-error testing", "description": "After reading an error, the participant attempts at least two revisions and evaluations."},
            {"id": "SYNTAX_SEMANTICS", "short": "Syntax → semantics", "label": "Syntax-to-semantics progression", "description": "A revision resolves a syntax error, after which the participant does not revise a behavioral problem."},
            {"id": "PASTE_DOC", "short": "Paste docs", "label": "Pastes documentation example", "description": "The participant pastes example code copied from documentation."},
            {"id": "PASTE_FIRST", "short": "Paste first", "label": "Paste is first edit", "description": "The first code-editing step is a paste."},
            {"id": "DELETE_REPASTE", "short": "Delete & repaste", "label": "Deletes paste before repasting", "description": "The participant deletes a paste before editing it and then pastes another piece of code."},
        ],
    },
    {
        "group": "General errors",
        "codes": [
            {"id": "INCOMPLETE_TOKEN", "short": "Incomplete token", "label": "Incomplete token", "description": "An evaluated program contains an appropriate lexical element that is incomplete."},
            {"id": "WRONG_TOKEN", "short": "Wrong token", "label": "Wrong token", "description": "An evaluated program contains a token that is invalid or inappropriate at its location."},
            {"id": "OTHER_LANGUAGE", "short": "Other language", "label": "Token from another language", "description": "The problematic token or form comes from another familiar programming language."},
            {"id": "NON_LANGUAGE", "short": "Not language", "label": "Token not from the language", "description": "The problematic token or form is not part of this language."},
            {"id": "INCORRECT_VALUE", "short": "Wrong value", "label": "Incorrect value", "description": "A value is syntactically usable but incorrect for the intended behavior."},
            {"id": "IDENTIFIER_ISSUE", "short": "Identifier", "label": "Variable, identifier, or field issue", "description": "The evaluation fails because a variable, identifier, or field is incomplete or incorrect."},
            {"id": "INCORRECT_BINDING", "short": "Binding", "label": "Incorrect binding", "description": "A name or resource is bound incorrectly."},
            {"id": "INCORRECT_DECLARATION", "short": "Declaration", "label": "Incorrect declaration", "description": "A declaration is incomplete or incorrect."},
            {"id": "INCORRECT_REFERENCE", "short": "Reference", "label": "Incorrect reference", "description": "A program refers to a value, object, or resource incorrectly."},
            {"id": "INCOMPLETE_STRUCTURE", "short": "Incomplete structure", "label": "Incomplete structure", "description": "An evaluated program is missing a token or formatting required to complete a program structure."},
            {"id": "INCORRECT_ARRANGEMENT", "short": "Arrangement", "label": "Incorrect arrangement", "description": "Required components exist but are nested, ordered, organized, or scoped incorrectly."},
            {"id": "VALID_WRONG_OUTPUT", "short": "Wrong output", "label": "Valid syntax but incorrect output", "description": "The program executes successfully but its output does not satisfy the task."},
        ],
    },
    {
        "group": "KnitScript challenges",
        "codes": [
            {"id": "TRANSLATE_REQUIREMENTS", "short": "Translate task", "label": "Translating task requirements", "description": "Difficulty converting width, cast-on, securing rows, releasehook, and body rows into a complete structure."},
            {"id": "REPAIR_STRUCTURE", "short": "Repair syntax", "label": "Repairing structure and syntax", "description": "Repeated revision of block boundaries, direction scopes, statements, or loop nesting before compilation."},
            {"id": "VALID_CAST_ON", "short": "Cast-on", "label": "Constructing a valid cast-on", "description": "Difficulty choosing stitch operation, needle pattern, carriage direction, and securing-row structure."},
            {"id": "CARRIER_BINDING", "short": "Carrier", "label": "Binding and using the carrier", "description": "Revision of carrier identifiers, declarations, or scope to obtain consistent carrier use."},
            {"id": "RELEASEHOOK_ROWS", "short": "Releasehook", "label": "Coordinating releasehook and rows", "description": "Difficulty positioning releasehook relative to securing and body rows."},
            {"id": "INITIAL_STRUCTURE", "short": "Initial scaffold", "label": "Choosing an initial program structure", "description": "Difficulty turning an initial needle idea into a workable width, carrier, direction, and cast-on scaffold."},
            {"id": "KNITSCRIPT_VS_PYTHON", "short": "KS vs Python", "label": "Distinguishing KnitScript from Python", "description": "Python imports, calls, arguments, or print debugging appear before returning to KnitScript."},
            {"id": "KNITOUT_VS_SOURCE", "short": "Knitout vs source", "label": "Distinguishing knitout from KnitScript", "description": "Generated knitout is pasted into the editor, tested, cleared, and replaced by KnitScript."},
            {"id": "WIDTH_ROW_STRUCTURE", "short": "Width & rows", "label": "Matching width and row structure", "description": "Difficulty aligning pattern dimensions and repeated rows with task requirements."},
        ],
    },
]


def build_dataset(source: Path) -> dict[str, object]:
    labels = [json.loads(line) for line in (source / "step_labels.jsonl").read_text().splitlines() if line.strip()]
    steps = []
    current_source = ""
    previous_source = ""
    for item in labels:
        raw = (source / item["file"]).read_text(encoding="utf-8")
        has_source = item.get("codeStateId") is not None
        if has_source:
            previous_source = current_source
            current_source = raw
        steps.append(
            {
                "index": item["step"],
                "event": item["sourceEventType"],
                "elapsedMs": item["elapsedMs"],
                "note": item["note"],
                "sourceSteps": item["sourceSteps"],
                "source": current_source,
                "previousSource": previous_source if has_source else current_source,
                "changed": has_source,
                "legacyLabels": item["labels"],
                "reading": (
                    {
                        "title": "KnitScript tutorial",
                        "location": "Tutorial opened before coding",
                        "excerpt": "Build a pattern from machine-aware blocks. Select needles, activate yarn, set a pass, work held loops, then repeat and release.",
                        "precision": "The legacy trace recorded the tutorial visit but not viewport coordinates.",
                    }
                    if item["sourceEventType"].startswith("guide.")
                    else None
                ),
            }
        )
    return {
        "schemaVersion": 1,
        "trace": {
            "id": "443bbe19-51d6-431e-bd0f-55baecdcc183",
            "participant": "6638e8aa3d1f38846080806a",
            "label": "Trace 6638e",
            "task": "stockinette-swatch-v1",
            "stepCount": len(steps),
            "status": "passed",
            "dataNote": "57 curated semantic steps. Later compiler checkpoints preserve exact source states; missing keystrokes were not inferred.",
        },
        "codebook": CODEBOOK,
        "steps": steps,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(build_dataset(args.source), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
