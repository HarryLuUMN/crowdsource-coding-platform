from importlib import import_module
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from programming_checkers import CHECKER_FILES, check_task
from study_tasks import DSL_TASK_CATALOG

ROOT = Path(__file__).resolve().parents[1]


class ProgrammingCheckerRegistryTests(unittest.TestCase):
    def test_all_twelve_catalog_tasks_have_distinct_task_files(self):
        expected = {}
        for dsl, group in DSL_TASK_CATALOG.items():
            folder = 'vegalite' if dsl == 'vega-lite' else dsl
            suffix = 'cjs' if dsl == 'idyll' else 'py'
            for index, task in enumerate(group['tasks'], 1):
                expected[task['id']] = f'{folder}/task{index}_checker.{suffix}'
        self.assertEqual(expected, CHECKER_FILES)
        self.assertEqual(12, len(set(CHECKER_FILES.values())))
        for relative in CHECKER_FILES.values():
            self.assertTrue((ROOT / 'programming-checkers' / relative).is_file(), relative)

    def test_python_dispatch_invokes_the_registered_task_module(self):
        for task_id, relative in CHECKER_FILES.items():
            if not relative.endswith('.py'):
                continue
            module = import_module('programming-checkers.' + relative.removesuffix('.py').replace('/', '.'))
            result = {'ok': False}
            expected = {'task_id': task_id, 'tests': []}
            with self.subTest(task=task_id), patch.object(module, 'check', return_value=expected) as checker:
                self.assertIs(expected, check_task(task_id, result))
                checker.assert_called_once_with(result, task_id)

    def test_idyll_modules_export_callable_checkers(self):
        script = "const fs=require('fs');const path=require('path');const entries=JSON.parse(fs.readFileSync('programming-checkers/registry.json','utf8'));for(const file of Object.values(entries).filter(file=>file.endsWith('.cjs'))){if(typeof require(path.resolve('programming-checkers',file)).check!=='function')throw Error(file);}" 
        child = subprocess.run(['node', '-e', script], cwd=ROOT, text=True, capture_output=True, timeout=10)
        self.assertEqual(0, child.returncode, child.stdout + child.stderr)


if __name__ == '__main__':
    unittest.main()
