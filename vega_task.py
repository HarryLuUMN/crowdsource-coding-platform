"""Fixed-data sales task checks for Vega-Lite specifications."""
import json
import subprocess
from pathlib import Path

TASK_ID = "vega-lite-sales-v1"
ROOT = Path(__file__).resolve().parent
SALES_DATA = [
    {"month": f"2025-{month:02d}-01", "category": category, "sales": values[month - 1]}
    for category, values in [
        ("Books", [120, 145, 130, 170, 185, 200]),
        ("Games", [90, 110, 150, 140, 175, 190]),
        ("Music", [100, 95, 115, 125, 120, 145]),
    ]
    for month in range(1, 7)
]


def evaluate_vega(source):
    tests = []
    spec = None
    error = None
    try:
        spec = json.loads(source)
        if not isinstance(spec, dict):
            raise ValueError("The specification must be a JSON object.")
        if spec.get("data") != {"url": "/sales-data.json"}:
            raise ValueError("Use the supplied dataset: data.url must be /sales-data.json.")
        if any(key in spec for key in ("transform", "layer", "concat", "hconcat", "vconcat", "facet", "repeat", "datasets")):
            raise ValueError("This task requires a single-view chart of the unchanged supplied data.")
        for key in spec:
            if key not in {"$schema", "data", "mark", "encoding", "params", "title", "width", "height", "config", "description", "background", "padding", "autosize"}:
                raise ValueError(f"Unsupported task specification property: {key}")
        encoding = spec.get("encoding", {})
        if not isinstance(encoding, dict):
            raise ValueError("encoding must be an object.")
        if set(encoding) - {"x", "y", "color", "tooltip", "opacity", "order", "detail"}:
            raise ValueError("Use position, category color, tooltip and opacity encodings for this task.")
        for channel in encoding.values():
            channels = channel if isinstance(channel, list) else [channel]
            if any(isinstance(item, dict) and ("aggregate" in item or "bin" in item or "timeUnit" in item) for item in channels):
                raise ValueError("Use the original monthly values without aggregation, binning or time-unit conversion.")
        mark = spec.get("mark", {})
        mark_type = mark if isinstance(mark, str) else mark.get("type") if isinstance(mark, dict) else None
        x, y, color = [encoding.get(key, {}) for key in ("x", "y", "color")]
        params = spec.get("params", [])
        params = params if isinstance(params, list) else []
        selection_names = {p.get("name") for p in params if isinstance(p, dict)
                           and p.get("bind") == "legend" and isinstance(p.get("select"), dict)
                           and p["select"].get("type") == "point"
                           and (p["select"].get("fields") == ["category"] or p["select"].get("encodings") == ["color"])}
        opacity = encoding.get("opacity", {})
        condition = opacity.get("condition", {}) if isinstance(opacity, dict) else {}
        interactive = isinstance(condition, dict) and condition.get("param") in selection_names
        interactive = interactive and isinstance(condition.get("value"), (int, float)) and isinstance(opacity.get("value"), (int, float))
        interactive = interactive and 0 <= opacity["value"] < condition["value"] <= 1
        tooltip = encoding.get("tooltip", [])
        tooltip_fields = {item.get("field") for item in tooltip if isinstance(item, dict)} if isinstance(tooltip, list) else set()
        checks = [
            ("line", "Line chart", mark_type == "line"),
            ("axes", "Month and sales axes", isinstance(x, dict) and isinstance(y, dict) and x.get("field") == "month" and x.get("type") == "temporal" and y.get("field") == "sales" and y.get("type") == "quantitative"),
            ("category", "Category colors", isinstance(color, dict) and color.get("field") == "category" and color.get("type") == "nominal" and color.get("legend", {}) not in (None, False)),
            ("tooltip", "Month, category and sales tooltip", {"month", "category", "sales"} <= tooltip_fields),
            ("selection", "Legend selection highlights categories", bool(interactive)),
            ("titles", "Chart and axis titles", bool(spec.get("title")) and isinstance(x, dict) and isinstance(y, dict) and bool(x.get("title") or (x.get("axis") or {}).get("title")) and bool(y.get("title") or (y.get("axis") or {}).get("title"))),
        ]
        tests = [{"id": key, "label": label, "passed": bool(passed), "message": "Requirement satisfied." if passed else "Revise the chart to satisfy this requirement."} for key, label, passed in checks]
        completed = subprocess.run(["node", "--max-old-space-size=128", str(ROOT / "scripts/vega_compile.cjs")], input=json.dumps({"spec": spec, "data": SALES_DATA}), text=True, capture_output=True, timeout=10, check=False)
        if not completed.stdout.strip():
            raise ValueError("The chart compiler stopped unexpectedly.")
        output = json.loads(completed.stdout)
        if completed.returncode or not output.get("ok"):
            raise ValueError(output.get("error", "Vega-Lite compilation failed."))
    except (ValueError, TypeError, AttributeError, OSError, subprocess.TimeoutExpired) as exc:
        error = {"type": type(exc).__name__, "message": str(exc)}
    passed_count = sum(test["passed"] for test in tests)
    return {"ok": error is None, "spec": spec if error is None else None, "error": error,
            "stdout": "Vega-Lite chart compiled and evaluated." if error is None else "",
            "check": {"task_id": TASK_ID, "passed": error is None and bool(tests) and passed_count == len(tests),
                      "passed_count": passed_count, "total_count": len(tests), "tests": tests}}
