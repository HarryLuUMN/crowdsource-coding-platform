"""Dispatch catalog task IDs to the per-task programming checker modules."""
from importlib import import_module
import json
from pathlib import Path
import subprocess

from vega_task import SALES_DATA

ROOT = Path(__file__).resolve().parent
CHECKER_FILES = json.loads((ROOT / 'programming-checkers/registry.json').read_text())
LEGACY_IDYLL_TASKS = {'idyll-converter-v1', 'idyll-conditional-v1'}


def check_task(task_id, result):
    if task_id in LEGACY_IDYLL_TASKS or CHECKER_FILES.get(task_id, '').endswith('.cjs'):
        return _check_idyll(result, task_id)
    module_path = CHECKER_FILES[task_id].removesuffix('.py').replace('/', '.')
    module = import_module(f'programming-checkers.{module_path}')
    return module.check(result, task_id)


def _check_idyll(result, task_id):
    results = import_module('programming-checkers.shared.results')
    if not result.get('ok'):
        return results.summarize(task_id, [results.make_test('compile', 'Valid Idyll program', False, 'Resolve the compiler error first.')])
    try:
        child = subprocess.run(
            ['node', '--max-old-space-size=128', str(ROOT / 'scripts/idyll_check.cjs')],
            input=json.dumps({'ast': result.get('ast'), 'task_id': task_id, 'data': SALES_DATA}),
            text=True, capture_output=True, timeout=10, check=False,
        )
        if child.returncode:
            raise ValueError('The safe expression checker could not run.')
        tests = json.loads(child.stdout)['tests']
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired) as error:
        tests = [results.make_test('checker', 'Reactive task check', False, str(error))]
    return results.summarize(task_id, tests)
