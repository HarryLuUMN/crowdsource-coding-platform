"""Read evaluated chart channels and format common chart requirements."""
from collections import Counter
import math

from .results import make_test, summarize


def number(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def colored_records(marks):
    observed = []
    for mark in marks:
        channels = mark.get("channels", {})
        x, y = channels.get("x"), channels.get("y")
        category = channels.get("stroke", channels.get("fill"))
        if number(x) and number(y) and isinstance(category, str):
            observed.append((round(x, 6), round(y, 6), category))
    return observed


def positioned(marks):
    return marks and len({mark.get("appearance", {}).get("x") for mark in marks}) > 1 and len({mark.get("appearance", {}).get("y") for mark in marks}) > 1


def colors(marks):
    return {mark.get("appearance", {}).get("stroke") or mark.get("appearance", {}).get("fill") for mark in marks}


def chart_checks(result, task_id, relevant, observed, expected, visible):
    compiled = result.get("ok") is True
    evidence = result.get("evidence", {})
    marks = evidence.get("marks", [])
    titles = evidence.get("titles", [])
    chart_titles = [title for title in titles if title.get("role") == "title-text" and title.get("text", "").strip()]
    axis_titles = [title for title in titles if title.get("role") == "axis-title" and title.get("text", "").strip()]
    conditions = [
        ("compiles", "Chart compiles and executes", compiled, "Fix the Vega-Lite execution error."),
        ("mark", "Required chart type", compiled and bool(relevant) and len(relevant) == len(marks), "Use only the required bar, line or point marks."),
        ("data", "Required data and visual encodings", compiled and visible and Counter(observed) == expected, "Encode all and only the required category totals or filtered records, with the requested x/y values and category colors."),
        ("titles", "Chart and axis titles", compiled and bool(chart_titles) and len(axis_titles) >= 2, "Include a chart title and titles for both axes."),
    ]
    return summarize(task_id, [make_test(*condition) for condition in conditions])
