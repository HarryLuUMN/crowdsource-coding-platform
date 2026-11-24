import json
import subprocess
import unittest
from pathlib import Path
from urllib.request import urlopen

import server
from dsl_runtime import evaluate_runtime
from study_tasks import DSL_TASK_CATALOG
from tests import test_server_api
from vega_task import SALES_DATA

ROOT = Path(__file__).resolve().parents[1]


class IdyllTaskCatalogTests(unittest.TestCase):
    def test_new_tasks_keep_level_one_and_version_the_replacements(self):
        tasks = DSL_TASK_CATALOG['idyll']['tasks']
        self.assertEqual(['idyll-calculator-v1', 'idyll-explorer-v2', 'idyll-story-v2'], [task['id'] for task in tasks])
        for task in tasks[1:]:
            self.assertTrue(task['article'].startswith('# '))
            self.assertGreaterEqual(task['article'].count('\n## '), 4)
            self.assertNotIn('[derived', task['article'])
            self.assertIn('Copy', task['description'])
            self.assertIn('sales-data.json', task['description'])

    def test_compiler_accepts_only_the_supplied_synchronous_dataset(self):
        declarations = [
            ('[data name:"sales" source:"sales-data.json" /]', True),
            ('[data name:"sales" source:"https://example.org/sales.json" /]', False),
            ('[data name:"sales" source:"sales-data.json" async:true /]', False),
            ('[data name:"other" source:"sales-data.json" /]', False),
            ('[data name:"sales" source:`"sales-data.json"` /]', False),
        ]
        for source, expected in declarations:
            with self.subTest(source=source):
                child = subprocess.run(['node', 'scripts/idyll_compile.cjs'], cwd=ROOT, input=json.dumps({'source': source}), text=True, capture_output=True, timeout=10)
                self.assertEqual(0, child.returncode, child.stderr)
                self.assertEqual(expected, json.loads(child.stdout)['ok'])

    def test_preview_receives_the_same_fixed_data_as_checks(self):
        _, result = evaluate_runtime('[data name:"sales" source:"sales-data.json" /]\n[Table data:sales /]', 'idyll-playground-v1')
        self.assertTrue(result['ok'], result)
        self.assertEqual(SALES_DATA, result['datasets']['sales'])


class IdyllTaskCatalogApiTests(unittest.TestCase):
    ADMIN_TOKEN = test_server_api.ServerApiTests.ADMIN_TOKEN
    setUp = test_server_api.ServerApiTests.setUp
    tearDown = test_server_api.ServerApiTests.tearDown
    get_text = test_server_api.ServerApiTests.get_text

    def test_task_catalog_serves_the_complete_copyable_articles(self):
        with urlopen(self.base_url + '/api/task-catalog') as response:
            tasks = json.loads(response.read())['catalog']['idyll']['tasks']
        self.assertEqual(DSL_TASK_CATALOG['idyll']['tasks'], tasks)
        status, html = self.get_text('/idyll?preview=1')
        self.assertEqual(200, status)
        self.assertIn('id="taskArticle"', html)
        self.assertIn('id="copyTaskArticle"', html)
        self.assertIn('id="taskArticleText"', html)
        self.assertIn('id="sourceEditor"', html)

    def test_advanced_task_evaluation_uses_new_rubrics(self):
        source = '[data name:"sales" source:"sales-data.json" /]\n[Table data:sales /]'
        for task in ['idyll-explorer-v2', 'idyll-story-v2']:
            with self.subTest(task=task):
                status, result = server.evaluate_source(source, task)
                self.assertEqual(200, status)
                self.assertTrue(result['ok'], result)
                self.assertFalse(result['check']['passed'])
                self.assertEqual(task, result['check']['task_id'])
                self.assertIn('controls', [test['id'] for test in result['check']['tests']])


if __name__ == '__main__':
    unittest.main()
