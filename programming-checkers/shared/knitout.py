"""Extract fabric evidence and common KnitScript requirements."""
from .results import make_test, summarize


def rows(operations):
    grouped, row = [], []
    for op in operations:
        if op[0] != "knit":
            continue
        if row and (op[1] != row[-1][1] or op[2] in {previous[2] for previous in row}):
            grouped.append(row)
            row = []
        row.append(op)
    if row:
        grouped.append(row)
    return grouped


def fabric_evidence(result):
    operations = [line.split(";", 1)[0].split() for line in result.get("knitout", "").splitlines()]
    operations = [op for op in operations if op]
    release = next((i for i, op in enumerate(operations) if op[0] == "releasehook"), -1)
    first_knit = next((i for i, op in enumerate(operations) if op[0] == "knit"), len(operations))
    body = rows(operations[release + 1:]) if release >= 0 else []
    securing = rows(operations[:release]) if release >= 0 else []
    tucks = [op for op in operations[:first_knit] if op[0] == "tuck"]
    positions = {int(op[2][1:]) for row in body for op in row if len(op) >= 4 and op[2][1:].lstrip("-").isdigit()}
    width = len(positions) == 10 and max(positions, default=0) - min(positions, default=0) == 9
    full_rows = width and len(body) == 6 and all(
        len(row) == 10 and {int(op[2][1:]) for op in row} == positions
        and len({op[2] for op in row}) == 10 for row in body
    )
    alternate = all(body[i][0][1] != body[i - 1][0][1] or body[i][0][3:] != body[i - 1][0][3:] for i in range(1, len(body)))
    cast_positions = [int(op[2][1:]) for op in tucks if len(op) >= 4]
    secure = release >= 0 and len(tucks) == 10 and len(set(cast_positions)) == 10 and set(cast_positions) == positions and len(securing) == 2 and all(
        len(row) == 10 and {int(op[2][1:]) for op in row} == positions for row in securing
    )
    allowed = {"inhook", "tuck", "knit", "releasehook", "outhook", "rack", "xfer"}
    first_body_knit = next((i for i, op in enumerate(operations) if i > release and op[0] == "knit"), len(operations))
    structural = all(op[0] in allowed for op in operations) and not any(op[0] == "tuck" for op in operations[first_knit:]) and not any(op[0] == "xfer" for op in operations[first_body_knit:])
    activated = {op[1] for op in operations if op[0] == "inhook"}
    released = {op[1] for op in operations if op[0] == "releasehook"}
    removed = {carrier for op in operations if op[0] == "outhook" for carrier in op[1:]}
    used = {carrier for row in body for op in row for carrier in op[3:]}
    return {
        "compiled": result.get("ok") is True,
        "body": body,
        "full_rows": full_rows,
        "secure": secure,
        "rows_valid": full_rows and alternate and structural,
        "row_carriers": [set(tuple(op[3:]) for op in row) for row in body],
        "finish": bool(used) and used <= activated & released & removed,
    }


def fabric_checks(task_id, evidence, bed_pattern, color_ok):
    compiled = evidence["compiled"]
    conditions = [
        ("compiles", "Program compiles", compiled, "Fix compiler errors before checking the fabric."),
        ("cast-on", "Secure cast-on", compiled and evidence["secure"], "Tuck each of the ten stitch positions once, then knit two full securing rows before the first releasehook."),
        ("rows", "Six complete ten-stitch fabric rows", compiled and evidence["rows_valid"], "After the first releasehook, knit six complete alternating-direction rows across ten consecutive positions without extra stitch operations."),
        ("beds", "Required stitch-bed pattern", compiled and bed_pattern, "Use alternating front/back beds consistently for ribbing, or front-bed stitches for stockinette."),
        ("carriers", "Required yarn sections", compiled and color_ok, "Use one carrier throughout, or two distinct single carriers for three rows each in the striped task."),
        ("finish", "Carrier setup and finishing", compiled and evidence["finish"], "Activate, release and outhook every carrier used in the fabric."),
    ]
    return summarize(task_id, [make_test(*condition) for condition in conditions])
