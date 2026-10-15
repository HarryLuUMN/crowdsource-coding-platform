import json
import unittest
from pathlib import Path
from urllib.request import urlopen
from unittest.mock import patch

import server
from tests import test_server_api


class VegaAnnotationApiTests(unittest.TestCase):
    ADMIN_TOKEN = test_server_api.ServerApiTests.ADMIN_TOKEN
    setUp = test_server_api.ServerApiTests.setUp
    tearDown = test_server_api.ServerApiTests.tearDown
    post_json = test_server_api.ServerApiTests.post_json

    def test_datasets_available_without_administrator_key(self):
        for key, count in [('5e219', 186), ('5f67b', 406)]:
            with urlopen(self.base_url + '/api/admin/annotation-dataset/' + key) as response:
                result = json.load(response)
            self.assertEqual(result['dataset']['trace']['task'], 'vega-lite-sales-v1')
            self.assertEqual(len(result['dataset']['steps']), count)
            self.assertIn('annotationRevision', result['dataset'])

    def test_local_save_for_vega_preserves_sources(self):
        original = json.loads((server.ANNOTATION_DATA_DIR / '5e219-units.json').read_text())
        target = Path(self.temp_dir.name) / '5e219-units.json'
        target.write_text(json.dumps(original))
        request = {'trace': '5e219', 'traceId': original['trace']['id'],
                   'granularity': original['granularity'], 'annotations': {'0': ['DOC_FIRST']},
                   'rawEventAnnotations': {}, 'ruleDecisions': {}}
        with patch.object(server, 'ANNOTATION_DATA_DIR', target.parent):
            self.assertEqual(self.post_json('/api/admin/annotation-save', request)[0], 200)
            saved = json.loads(target.read_text())
            self.assertEqual(saved['steps'], original['steps'])
            self.assertEqual(saved['rawSteps'], original['rawSteps'])
            with patch.object(server.KnitScriptHandler, '_annotation_local', return_value=False):
                self.assertEqual(self.post_json('/api/admin/annotation-save', request)[0], 403)


if __name__ == '__main__':
    unittest.main()
