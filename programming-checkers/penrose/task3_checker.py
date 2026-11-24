"""Disjoint sets containing their requested points."""
from ..shared.geometry import diagram_checks


def check(result, task_id):
    required = {'A': 'Set', 'B': 'Set', 'p': 'Point', 'q': 'Point'}
    relationships = [('Disjoint', 'A', 'B'), ('In', 'p', 'A'), ('NotIn', 'p', 'B'), ('In', 'q', 'B'), ('NotIn', 'q', 'A')]
    return diagram_checks(result, task_id, required, relationships)
