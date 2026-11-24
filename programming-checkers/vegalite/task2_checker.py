"""Monthly sales lines for Books and Games."""
from collections import Counter
from datetime import datetime, timezone

from vega_task import SALES_DATA
from ..shared.charts import chart_checks, colored_records, colors, positioned


def check(result, task_id):
    marks = result.get("evidence", {}).get("marks", [])
    lines = [mark for mark in marks if mark.get("type") == "line"]
    expected = Counter((datetime.fromisoformat(row["month"]).replace(tzinfo=timezone.utc).timestamp() * 1000, row["sales"], row["category"]) for row in SALES_DATA if row["category"] in {"Books", "Games"})
    visible = positioned(lines) and len(colors(lines)) >= 2
    return chart_checks(result, task_id, lines, colored_records(lines), expected, visible)
