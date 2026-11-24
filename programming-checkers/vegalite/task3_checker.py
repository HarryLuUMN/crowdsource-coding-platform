"""Colored monthly sales points filtered to sales of at least 120."""
from collections import Counter

from vega_task import SALES_DATA
from ..shared.charts import chart_checks, colored_records, colors, positioned


def check(result, task_id):
    marks = result.get("evidence", {}).get("marks", [])
    points = [mark for mark in marks if mark.get("type") == "symbol"]
    expected = Counter((int(row["month"][5:7]), row["sales"], row["category"]) for row in SALES_DATA if row["sales"] >= 120)
    visible = positioned(points) and len(colors(points)) >= 3
    visible = visible and all(mark.get("appearance", {}).get("size", 0) > 0 for mark in points)
    return chart_checks(result, task_id, points, colored_records(points), expected, visible)
