import json
import subprocess
import unittest
from unittest.mock import patch
from urllib.request import urlopen

import server
from dsl_runtime import evaluate_runtime
from tests.test_server_api import ServerApiTests


class RuntimeFailureTests(unittest.TestCase):
    def test_timeout_and_runner_failure_are_not_compiler_success(self):
        for error, expected in [(subprocess.TimeoutExpired('node', 25), 408), (OSError('missing node'), 500)]:
            with self.subTest(error=error), patch('dsl_runtime.subprocess.run', side_effect=error):
                status, result = evaluate_runtime('Set A', 'penrose-playground-v1')
                self.assertEqual(status, expected)
                self.assertFalse(result['ok'])
                self.assertFalse(result['check']['passed'])
        for output in ['not json', '[]', '{"ok":"yes"}']:
            with patch('dsl_runtime.subprocess.run', return_value=subprocess.CompletedProcess([], 0, output, '')):
                self.assertEqual(evaluate_runtime('Set A', 'penrose-playground-v1')[0], 500)

    def test_new_language_source_validation(self):
        for task in ['idyll-playground-v1', 'penrose-playground-v1']:
            for source in [None, '', ' ', 'a' * 100001]:
                self.assertEqual(server.evaluate_source(source, task)[0], 400)


class RuntimeApiTests(unittest.TestCase):
    ADMIN_TOKEN = ServerApiTests.ADMIN_TOKEN
    setUp = ServerApiTests.setUp
    tearDown = ServerApiTests.tearDown
    post_json = ServerApiTests.post_json

    def test_languages_run_but_cannot_pass_study_submission(self):
        for task, source, artifact in [
            ('idyll-playground-v1', '[var name:"x" value:2 /]\n[Range value:x min:0 max:10 /]\n[Display value:x /]', 'ast'),
            ('penrose-playground-v1', 'Set A, B\nSubset(A, B)\nAutoLabel All', 'svg'),
        ]:
            with self.subTest(task=task):
                status, session = self.post_json('/api/sessions', {'participant_id': 'runtime-test', 'task_id': task, 'initial_source': ''})
                self.assertEqual(status, 201)
                sid = session['session']['session_id']
                request = {'task_id': task, 'source': source, 'session_id': sid}
                status, result = self.post_json('/api/run', request)
                self.assertEqual(status, 200)
                self.assertTrue(result['ok'], result)
                self.assertTrue(result[artifact])
                self.assertTrue(result['trace_saved'])
                self.assertFalse(result['check']['passed'])
                self.assertEqual(self.post_json('/api/submit', request)[0], 400)
                request['task_id'] = 'vega-lite-sales-v1'
                self.assertEqual(self.post_json('/api/run', request)[0], 400)

    def test_idyll_preview_is_opaque_and_cannot_connect(self):
        with urlopen(self.base_url + '/idyll-preview.html') as response:
            policy = response.headers['Content-Security-Policy']
            self.assertIn('sandbox allow-scripts', policy)
            self.assertNotIn('allow-same-origin', policy)
            self.assertIn("connect-src 'none'", policy)
        with urlopen(self.base_url + '/') as response:
            self.assertNotIn("'unsafe-eval'", response.headers['Content-Security-Policy'])


if __name__ == '__main__':
    unittest.main()
