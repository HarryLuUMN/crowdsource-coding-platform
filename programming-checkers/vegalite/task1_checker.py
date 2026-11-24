"""Category sales totals rendered as bars."""
from collections import Counter

from vega_task import SALES_DATA
from ..shared.charts import chart_checks, number


def check(result, task_id):
    marks = result.get("evidence", {}).get("marks", [])
    bars = [mark for mark in marks if mark.get("type") == "rect"]
    observed = []
    for mark in bars:
        channels = mark.get("channels", {})
        x, y = channels.get("x"), channels.get("y")
        if isinstance(x, str) and number(y):
            observed.append((x, round(y, 6)))
        elif isinstance(y, str) and number(x):
            observed.append((y, round(x, 6)))
    totals = Counter()
    for row in SALES_DATA:
        totals[row["category"]] += row["sales"]
    expected = Counter((category, total) for category, total in totals.items())
    visible = (len({mark.get("appearance", {}).get("x") for mark in bars}) > 1 or len({mark.get("appearance", {}).get("y") for mark in bars}) > 1) and all(mark.get("appearance", {}).get("width", 0) > 0 and mark.get("appearance", {}).get("height", 0) > 0 for mark in bars)
    return chart_checks(result, task_id, bars, observed, expected, visible)
