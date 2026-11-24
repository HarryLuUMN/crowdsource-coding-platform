"""Ribbed swatch requirements."""
from ..shared.knitout import fabric_checks, fabric_evidence


def check(result, task_id):
    evidence = fabric_evidence(result)
    body, carriers = evidence["body"], evidence["row_carriers"]
    beds = evidence["full_rows"] and all(all(op[2][0] != row[j - 1][2][0] for j, op in enumerate(row) if j) for row in body)
    if body:
        pattern = {int(op[2][1:]): op[2][0] for op in body[0]}
        beds = beds and all(all(pattern.get(int(op[2][1:])) == op[2][0] for op in row) for row in body)
    yarn = all(len(group) == 1 for group in carriers) and bool(carriers) and all(group == carriers[0] for group in carriers)
    return fabric_checks(task_id, evidence, beds, yarn)
