"""Two intersecting sets and a disjoint third set."""
from ..shared.geometry import diagram_checks


def check(result, task_id):
    required = {'A': 'Set', 'B': 'Set', 'C': 'Set'}
    relationships = [('Intersecting', 'A', 'B'), ('Disjoint', 'A', 'C'), ('Disjoint', 'B', 'C')]
    return diagram_checks(result, task_id, required, relationships)
