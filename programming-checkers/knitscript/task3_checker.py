"""Two-color stockinette swatch requirements."""
from ..shared.knitout import fabric_checks, fabric_evidence


def check(result, task_id):
    evidence = fabric_evidence(result)
    body, carriers = evidence["body"], evidence["row_carriers"]
    beds = evidence["full_rows"] and all(op[2].startswith("f") for row in body for op in row)
    yarn = all(len(group) == 1 for group in carriers) and len(carriers) == 6 and carriers[0] == carriers[1] == carriers[2] and carriers[3] == carriers[4] == carriers[5] and carriers[0] != carriers[3] and all(len(next(iter(group))) == 1 for group in carriers)
    return fabric_checks(task_id, evidence, beds, yarn)
