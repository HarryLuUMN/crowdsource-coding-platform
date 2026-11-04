import json
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server
from study_tasks import DSL_TASK_CATALOG, TASK_DSL
from tests import test_server_api
from tests.test_compiler import VALID_PROGRAM


class DslRouteTests(unittest.TestCase):
    ADMIN_TOKEN = test_server_api.ServerApiTests.ADMIN_TOKEN
    setUp = test_server_api.ServerApiTests.setUp
    tearDown = test_server_api.ServerApiTests.tearDown
    post_json = test_server_api.ServerApiTests.post_json

    def test_four_paths_and_slash_variants_serve_same_editor(self):
        for dsl in DSL_TASK_CATALOG:
            for suffix in ['', '/']:
                with urlopen(self.base_url + '/' + dsl + suffix + '?PROLIFIC_PID=preserved') as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn('sourceEditor', response.read().decode())
                with urlopen(Request(self.base_url + '/' + dsl + suffix, method='HEAD')) as response:
                    self.assertEqual(response.status, 200)
        with self.assertRaises(HTTPError) as missing:
            urlopen(self.base_url + '/unknown-dsl')
        self.assertEqual(missing.exception.code, 404)

    def test_shared_catalog_is_complete(self):
        with urlopen(self.base_url + '/api/task-catalog') as response:
            catalog = json.load(response)['catalog']
        self.assertEqual(catalog, DSL_TASK_CATALOG)
        self.assertEqual(len(TASK_DSL), 12)
        self.assertTrue(all(len(entry['tasks']) == 3 for entry in catalog.values()))
        with urlopen(self.base_url + '/task-catalog.js') as response:
            script = response.read().decode()
            self.assertTrue(script.startswith('window.DSL_TASK_CATALOG = '))
            self.assertEqual(json.loads(script.removeprefix('window.DSL_TASK_CATALOG = ').strip().removesuffix(';')), catalog)

    def test_new_task_requires_matching_dsl_at_session_and_run(self):
        for path in ['/api/sessions', '/api/run']:
            payload = {'participant_id': 'route-test', 'task_id': 'penrose-nested-v1', 'source': 'Set A'}
            self.assertEqual(self.post_json(path, payload)[0], 400)
            payload['dsl'] = 'idyll'
            self.assertEqual(self.post_json(path, payload)[0], 400)
        self.assertEqual(self.post_json('/api/run', {'task_id': [], 'source': 'Set A'})[0], 400)

    def test_catalog_execution_persists_exact_task_and_rejects_cross_task(self):
        request = {'participant_id': 'route-test', 'dsl': 'penrose', 'task_id': 'penrose-nested-v1', 'initial_source': ''}
        status, session = self.post_json('/api/sessions', request)
        self.assertEqual(status, 201)
        run = {'dsl': 'penrose', 'task_id': 'penrose-nested-v1', 'source': 'Set A, B\nSubset(A, B)\nAutoLabel All', 'session_id': session['session']['session_id']}
        status, result = self.post_json('/api/run', run)
        self.assertEqual(status, 200)
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['check']['task_id'], run['task_id'])
        self.assertTrue(result['trace_saved'])
        self.assertFalse(result['check']['passed'])
        self.assertEqual(self.post_json('/api/submit', run)[0], 200)
        run['task_id'] = 'penrose-overlap-v1'
        self.assertEqual(self.post_json('/api/run', run)[0], 400)

    def test_all_four_catalog_runners(self):
        cases = [
            ('knitscript', 'knitscript-plain-v1', VALID_PROGRAM),
            ('vega-lite', 'vega-lite-bar-v1', json.dumps({'data': {'url': '/sales-data.json'}, 'mark': 'bar', 'encoding': {'x': {'field': 'category', 'type': 'nominal'}, 'y': {'aggregate': 'sum', 'field': 'sales', 'type': 'quantitative'}}})),
            ('idyll', 'idyll-calculator-v1', '[var name:"q" value:2 /]\n[Display value:`q * 5` /]'),
            ('penrose', 'penrose-nested-v1', 'Set A\nPoint p\nIn(p, A)\nAutoLabel All'),
        ]
        for dsl, task, source in cases:
            with self.subTest(dsl=dsl):
                status, result = server.evaluate_source(source, task)
                self.assertEqual(status, 200)
                self.assertTrue(result['ok'], result)
                self.assertEqual(result['check']['task_id'], task)
                self.assertFalse(result['check']['passed'])

    def test_general_vega_preserves_data_and_blocks_external_resources(self):
        request = {'dsl': 'vega-lite', 'task_id': 'vega-lite-scatter-v1', 'source': json.dumps({'data': {'values': [{'x': 1, 'y': 2}]}, 'transform': [{'filter': 'datum.x > 0'}], 'mark': 'point', 'encoding': {'x': {'field': 'x', 'type': 'quantitative'}, 'y': {'field': 'y', 'type': 'quantitative'}}})}
        _, result = server.evaluate_source(request['source'], request['task_id'])
        self.assertTrue(result['ok'], result)
        self.assertEqual(result['spec']['data']['values'], [{'x': 1, 'y': 2}])
        request['source'] = json.dumps({'data': {'url': 'https://example.com/data.json'}, 'mark': 'point'})
        _, result = server.evaluate_source(request['source'], request['task_id'])
        self.assertFalse(result['ok'])
        self.assertIn('External resources', result['error']['message'])


if __name__ == '__main__':
    unittest.main()
