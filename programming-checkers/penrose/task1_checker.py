"""Three nested sets."""
from ..shared.geometry import diagram_checks


def check(result, task_id):
    required = {'A': 'Set', 'B': 'Set', 'C': 'Set'}
    relationships = [('Subset', 'A', 'B'), ('Subset', 'B', 'C')]
    return diagram_checks(result, task_id, required, relationships)
