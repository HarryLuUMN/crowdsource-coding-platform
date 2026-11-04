import json
from pathlib import Path
import unittest
from unittest.mock import patch

import server
from tests import test_server_api
from trace_store import TraceStore


SOURCES = [
    'Set A, B, C\nSubset(A, B)\nSubset(B, C)\nAutoLabel All',
    'Set A, B, C\nIntersecting(A, B)\nDisjoint(A, C)\nDisjoint(B, C)\nAutoLabel All',
    'Set A, B\nPoint p, q\nDisjoint(A, B)\nIn(p, A)\nNotIn(p, B)\nIn(q, B)\nNotIn(q, A)\nAutoLabel All',
]
TASKS = ['penrose-nested-v1', 'penrose-overlap-v1', 'penrose-points-v1']


class SequentialApiTests(unittest.TestCase):
    ADMIN_TOKEN = test_server_api.ServerApiTests.ADMIN_TOKEN
    setUp = test_server_api.ServerApiTests.setUp
    tearDown = test_server_api.ServerApiTests.tearDown
    post_json = test_server_api.ServerApiTests.post_json

    def identity(self, study='sequential-study'):
        return {'participant_id': 'sequential-user', 'dsl': 'penrose', 'recruitment': {'source': 'prolific', 'study_id': study, 'prolific_session_id': 'sequential-session', 'prolific_pid': 'sequential-user'}}

    def progress(self, study='sequential-study'):
        status, result = self.post_json('/api/progress', self.identity(study))
        self.assertEqual(status, 200)
        return result['progress']

    def session(self, index):
        status, result = self.post_json('/api/sessions', {**self.identity(), 'task_id': TASKS[index], 'initial_source': ''})
        self.assertEqual(status, 201, result)
        return result['session']['session_id']

    def submit(self, index, sid, source=None):
        return self.post_json('/api/submit', {'dsl': 'penrose', 'task_id': TASKS[index], 'source': SOURCES[index] if source is None else source, 'session_id': sid})

    def test_sequential_submissions_are_durable_and_scoped(self):
        initial = self.progress()
        self.assertEqual(initial['current_task_id'], TASKS[0])
        self.assertEqual([task['unlocked'] for task in initial['tasks']], [True, False, False])
        for index in [1, 2]:
            self.assertEqual(self.post_json('/api/sessions', {**self.identity(), 'task_id': TASKS[index]})[0], 400)
            self.assertEqual(self.post_json('/api/run', {'dsl': 'penrose', 'task_id': TASKS[index], 'source': SOURCES[index]})[0], 400)
        first = self.session(0)
        status, failure = self.submit(0, first, 'Set A\nAutoLabel All')
        self.assertEqual(status, 200)
        self.assertFalse(failure['submission']['passed'])
        self.assertTrue(failure['trace_saved'])
        self.assertEqual(self.progress()['current_task_id'], TASKS[0])
        with patch.object(server.get_trace_store(), 'record_execution', side_effect=OSError('execution save unavailable')):
            self.assertEqual(self.submit(0, first)[0], 500)
        self.assertEqual(self.progress()['current_task_id'], TASKS[0])
        for index in range(3):
            sid = first if index == 0 else self.session(index)
            status, accepted = self.submit(index, sid)
            self.assertEqual(status, 200, accepted)
            self.assertTrue(accepted['submission']['passed'], accepted['check'])
            self.assertTrue(accepted['trace_saved'])
            self.assertEqual(self.progress()['current_task_id'], TASKS[index], 'Submission must not unlock before final trace save')
            self.assertEqual(self.post_json('/api/sessions/end', {'session_id': sid, 'final_source': SOURCES[index] + '\nSet Other'})[0], 400)
            with patch.object(server.get_trace_store(), 'end_session', side_effect=OSError('save unavailable')):
                self.assertEqual(self.post_json('/api/sessions/end', {'session_id': sid, 'final_source': SOURCES[index]})[0], 500)
            self.assertEqual(self.progress()['current_task_id'], TASKS[index])
            status, ended = self.post_json('/api/sessions/end', {'session_id': sid, 'final_source': SOURCES[index]})
            self.assertEqual(status, 200, ended)
            self.assertEqual(ended['progress']['current_task_id'], TASKS[index + 1] if index < 2 else None)
            self.assertTrue(ended['progress']['tasks'][index]['completed'])
            self.assertEqual(self.submit(index, sid)[0], 400, 'Completed sessions must stay immutable')
            self.assertEqual(self.post_json('/api/sessions/end', {'session_id': sid, 'final_source': SOURCES[index] + '\nSet Other'})[0], 400)
        self.assertTrue(self.progress()['completed'])
        self.assertEqual(self.progress('another-study')['current_task_id'], TASKS[0])
        server._trace_store = TraceStore(server.get_trace_store().root)
        self.assertTrue(self.progress()['completed'], 'Progress must survive a fresh store instance')

    def test_all_twelve_tasks_accept_real_solutions_in_order(self):
        from study_tasks import DSL_TASK_CATALOG
        from tests.test_catalog_checks import KNIT_SOURCES, VEGA_SPECS
        sources = dict(KNIT_SOURCES)
        sources.update({task: json.dumps(spec) for task, spec in VEGA_SPECS.items()})
        sources.update(json.loads((Path(__file__).parent / 'fixtures/structured_solutions.json').read_text()))
        for dsl, group in DSL_TASK_CATALOG.items():
            identity = {**self.identity(), 'dsl': dsl, 'participant_id': 'all-solutions-user'}
            for task in group['tasks']:
                with self.subTest(task=task['id']):
                    status, created = self.post_json('/api/sessions', {**identity, 'task_id': task['id'], 'initial_source': ''})
                    self.assertEqual(status, 201, created)
                    sid = created['session']['session_id']
                    request = {'dsl': dsl, 'task_id': task['id'], 'session_id': sid, 'source': sources[task['id']]}
                    status, accepted = self.post_json('/api/submit', request)
                    self.assertEqual(status, 200, accepted)
                    self.assertTrue(accepted['check']['passed'], accepted['check'])
                    self.assertTrue(accepted['trace_saved'])
                    status, finalized = self.post_json('/api/sessions/end', {'session_id': sid, 'final_source': request['source']})
                    self.assertEqual(status, 200, finalized)
                    self.assertTrue(next(item for item in finalized['progress']['tasks'] if item['id'] == task['id'])['completed'])
            self.assertTrue(finalized['progress']['completed'])


if __name__ == '__main__':
    unittest.main()
