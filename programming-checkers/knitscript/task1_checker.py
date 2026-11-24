"""Stockinette swatch requirements."""
from ..shared.knitout import fabric_checks, fabric_evidence


def check(result, task_id):
    evidence = fabric_evidence(result)
    body, carriers = evidence["body"], evidence["row_carriers"]
    beds = evidence["full_rows"] and all(op[2].startswith("f") for row in body for op in row)
    yarn = all(len(group) == 1 for group in carriers) and bool(carriers) and all(group == carriers[0] for group in carriers)
    return fabric_checks(task_id, evidence, beds, yarn)
