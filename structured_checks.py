"""Task checks over compiled Idyll ASTs and rendered Penrose evidence."""
import json
import math
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent


def _check(task_id, tests):
    count = sum(bool(test['passed']) for test in tests)
    return {'task_id': task_id, 'passed': bool(tests) and count == len(tests), 'passed_count': count, 'total_count': len(tests), 'tests': tests}


def _test(key, label, passed, message):
    return {'id': key, 'label': label, 'passed': bool(passed), 'message': 'Requirement satisfied.' if passed else message}


def check_idyll(source, result, task_id):
    if not result.get('ok'):
        return _check(task_id, [_test('compile', 'Valid Idyll program', False, 'Resolve the compiler error first.')])
    try:
        child = subprocess.run(['node', '--max-old-space-size=128', str(ROOT / 'scripts/idyll_check.cjs')], input=json.dumps({'ast': result.get('ast'), 'task_id': task_id}), text=True, capture_output=True, timeout=10, check=False)
        if child.returncode:
            raise ValueError('The safe expression checker could not run.')
        tests = json.loads(child.stdout)['tests']
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        tests = [_test('checker', 'Reactive task check', False, str(error))]
    return _check(task_id, tests)


def check_penrose(source, result, task_id):
    evidence = result.get('evidence') or {}
    objects, labels, shapes = [evidence.get(key, {}) for key in ('objects', 'labels', 'shapes')]
    predicates = {(item['name'], tuple(item['args'])) for item in evidence.get('predicates', [])}
    required = {'A':'Set', 'B':'Set', 'C':'Set'} if task_id != 'penrose-points-v1' else {'A':'Set', 'B':'Set', 'p':'Point', 'q':'Point'}
    declared = result.get('ok') and all(objects.get(name) == kind for name, kind in required.items())
    tests = [_test('objects', 'Required typed objects', declared, 'Declare all requested sets and points with the required names.')]
    tests.append(_test('labels', 'Labels on all requested objects', declared and all(str(labels.get(name, '')).strip() for name in required), 'Label every requested object.'))

    def relation(name, first, second):
        present = (name, (first, second)) in predicates or (name in {'Disjoint','Intersecting'} and (name, (second, first)) in predicates)
        valid = False
        try:
            a, b = shapes[first], shapes[second]
            distance = math.dist(a['center'], b['center'])
            ra, rb = a['radius'], b['radius']
            if all(math.isfinite(value) for value in [distance, ra, rb]) and ra > 0 and rb > 0:
                if name in {'Subset','In'}:
                    valid = distance + ra <= rb + 0.5
                elif name in {'Disjoint','NotIn'}:
                    valid = distance >= ra + rb - 0.5
                elif name == 'Intersecting':
                    valid = abs(ra - rb) + 0.5 < distance < ra + rb - 0.5
        except (KeyError, TypeError, ValueError):
            pass
        return _test(f'{name}-{first}-{second}', f'{name}({first}, {second})', declared and present and valid, 'Specify this relationship and ensure the rendered diagram satisfies it; remove conflicting relationships if necessary.')

    if task_id == 'penrose-nested-v1':
        requirements = [('Subset','A','B'), ('Subset','B','C')]
    elif task_id == 'penrose-overlap-v1':
        requirements = [('Intersecting','A','B'), ('Disjoint','A','C'), ('Disjoint','B','C')]
    else:
        requirements = [('Disjoint','A','B'), ('In','p','A'), ('NotIn','p','B'), ('In','q','B'), ('NotIn','q','A')]
    tests.extend(relation(*requirement) for requirement in requirements)
    return _check(task_id, tests)
