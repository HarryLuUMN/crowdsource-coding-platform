"""Task rubrics based on compiled stitch operations and evaluated chart marks."""
from collections import Counter
from datetime import datetime, timezone
import math

from vega_task import SALES_DATA


def _check(task_id, conditions):
    tests = [{"id": key, "label": label, "passed": bool(passed), "message": "Requirement satisfied." if passed else message} for key, label, passed, message in conditions]
    count = sum(test["passed"] for test in tests)
    return {"task_id": task_id, "passed": count == len(tests), "passed_count": count, "total_count": len(tests), "tests": tests}


def _rows(operations):
    rows, row = [], []
    for op in operations:
        if op[0] != "knit":
            continue
        if row and (op[1] != row[-1][1] or op[2] in {previous[2] for previous in row}):
            rows.append(row)
            row = []
        row.append(op)
    if row:
        rows.append(row)
    return rows


def check_knit(result, task_id):
    compiled = result.get("ok") is True
    operations = [line.split(";", 1)[0].split() for line in result.get("knitout", "").splitlines()]
    operations = [op for op in operations if op]
    release = next((i for i, op in enumerate(operations) if op[0] == "releasehook"), -1)
    first_knit = next((i for i, op in enumerate(operations) if op[0] == "knit"), len(operations))
    body = _rows(operations[release + 1:]) if release >= 0 else []
    securing = _rows(operations[:release]) if release >= 0 else []
    tucks = [op for op in operations[:first_knit] if op[0] == "tuck"]
    positions = {int(op[2][1:]) for row in body for op in row if len(op) >= 4 and op[2][1:].lstrip("-").isdigit()}
    width = len(positions) == 10 and max(positions, default=0) - min(positions, default=0) == 9
    full_rows = width and len(body) == 6 and all(len(row) == 10 and {int(op[2][1:]) for op in row} == positions and len({op[2] for op in row}) == 10 for row in body)
    alternate = all(body[i][0][1] != body[i - 1][0][1] for i in range(1, len(body)))
    cast_positions = [int(op[2][1:]) for op in tucks if len(op) >= 4]
    secure = release >= 0 and len(tucks) == 10 and len(set(cast_positions)) == 10 and set(cast_positions) == positions and len(securing) == 2 and all(len(row) == 10 and {int(op[2][1:]) for op in row} == positions for row in securing)
    allowed = {"inhook", "tuck", "knit", "releasehook", "outhook", "rack", "xfer"}
    structural = all(op[0] in allowed for op in operations) and not any(op[0] == "tuck" for op in operations[first_knit:])
    rib = task_id == "knitscript-ribbed-v1"
    bed_pattern = full_rows and all(all((op[2][0] != row[j - 1][2][0]) for j, op in enumerate(row) if j) for row in body) if rib else full_rows and all(op[2].startswith("f") for row in body for op in row)
    if rib and body:
        pattern = {int(op[2][1:]): op[2][0] for op in body[0]}
        bed_pattern = bed_pattern and all(all(pattern.get(int(op[2][1:])) == op[2][0] for op in row) for row in body)
    carriers = [tuple(op[3:] for op in row) for row in body]
    row_carriers = [set(tuple(op[3:]) for op in row) for row in body]
    color_ok = all(len(c) == 1 for c in row_carriers)
    if task_id == "knitscript-striped-v1":
        color_ok = color_ok and len(row_carriers) == 6 and row_carriers[0] == row_carriers[1] == row_carriers[2] and row_carriers[3] == row_carriers[4] == row_carriers[5] and row_carriers[0] != row_carriers[3] and all(len(next(iter(c))) == 1 for c in row_carriers)
    else:
        color_ok = color_ok and bool(row_carriers) and all(c == row_carriers[0] for c in row_carriers)
    activated = {op[1] for op in operations if op[0] == "inhook"}
    released = {op[1] for op in operations if op[0] == "releasehook"}
    removed = {carrier for op in operations if op[0] == "outhook" for carrier in op[1:]}
    used = {carrier for row in body for op in row for carrier in op[3:]}
    finish = bool(used) and used <= activated & released & removed
    return _check(task_id, [
        ("compiles", "Program compiles", compiled, "Fix compiler errors before checking the fabric."),
        ("cast-on", "Secure cast-on", compiled and secure, "Tuck each of the ten stitch positions once, then knit two full securing rows before the first releasehook."),
        ("rows", "Six complete ten-stitch fabric rows", compiled and full_rows and alternate and structural, "After the first releasehook, knit six complete alternating-direction rows across ten consecutive positions without extra stitch operations."),
        ("beds", "Required stitch-bed pattern", compiled and bed_pattern, "Use alternating front/back beds consistently for ribbing, or front-bed stitches for stockinette."),
        ("carriers", "Required yarn sections", compiled and color_ok, "Use one carrier throughout, or two distinct single carriers for three rows each in the striped task."),
        ("finish", "Carrier setup and finishing", compiled and finish, "Activate, release and outhook every carrier used in the fabric."),
    ])


def _number(value):
    return isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value)


def check_vega(result, task_id):
    compiled = result.get("ok") is True
    evidence = result.get("evidence", {})
    marks = evidence.get("marks", [])
    titles = evidence.get("titles", [])
    wanted = "rect" if task_id == "vega-lite-bar-v1" else "line" if task_id == "vega-lite-line-v1" else "symbol"
    relevant = [mark for mark in marks if mark.get("type") == wanted]
    observed = []
    for mark in relevant:
        channels = mark.get("channels", {})
        x, y = channels.get("x"), channels.get("y")
        category = channels.get("stroke", channels.get("fill"))
        if task_id == "vega-lite-bar-v1":
            if isinstance(x, str) and _number(y):
                observed.append((x, round(y, 6)))
            elif isinstance(y, str) and _number(x):
                observed.append((y, round(x, 6)))
        elif _number(x) and _number(y) and isinstance(category, str):
            observed.append((round(x, 6), round(y, 6), category))
    if task_id == "vega-lite-bar-v1":
        sums = Counter()
        for row in SALES_DATA:
            sums[row["category"]] += row["sales"]
        expected = Counter((category, total) for category, total in sums.items())
    elif task_id == "vega-lite-line-v1":
        expected = Counter((datetime.fromisoformat(row["month"]).replace(tzinfo=timezone.utc).timestamp() * 1000, row["sales"], row["category"]) for row in SALES_DATA if row["category"] in {"Books", "Games"})
    else:
        expected = Counter((int(row["month"][5:7]), row["sales"], row["category"]) for row in SALES_DATA if row["sales"] >= 120)
    chart_titles = [title for title in titles if title.get("role") == "title-text" and title.get("text", "").strip()]
    axis_titles = [title for title in titles if title.get("role") == "axis-title" and title.get("text", "").strip()]
    return _check(task_id, [
        ("compiles", "Chart compiles and executes", compiled, "Fix the Vega-Lite execution error."),
        ("mark", "Required chart type", compiled and bool(relevant) and len(relevant) == len(marks), "Use only the required bar, line or point marks."),
        ("data", "Required data and visual encodings", compiled and Counter(observed) == expected, "Encode all and only the required category totals or filtered records, with the requested x/y values and category colors."),
        ("titles", "Chart and axis titles", compiled and bool(chart_titles) and len(axis_titles) >= 2, "Include a chart title and titles for both axes."),
    ])
