import json
import unittest
from urllib.request import urlopen

import server
from tests import test_server_api, test_vega_task


class VegaApiTests(unittest.TestCase):
    ADMIN_TOKEN = test_server_api.ServerApiTests.ADMIN_TOKEN
    setUp = test_server_api.ServerApiTests.setUp
    tearDown = test_server_api.ServerApiTests.tearDown
    post_json = test_server_api.ServerApiTests.post_json

    def test_submit_and_saved_task_identity(self):
        fixture = test_vega_task.VegaTaskTests()
        fixture.setUp()
        status, body = self.post_json("/api/sessions", {"participant_id": "vega-api-test", "task_id": "vega-lite-sales-v1", "initial_source": ""})
        self.assertEqual(status, 201)
        session_id = body["session"]["session_id"]
        status, result = self.post_json("/api/submit", {"source": json.dumps(fixture.spec), "task_id": "vega-lite-sales-v1", "session_id": session_id})
        self.assertEqual(status, 200)
        self.assertTrue(result["submission"]["passed"])
        manifest = server.get_trace_store()._read_manifest(session_id)
        self.assertEqual(manifest["task_id"], "vega-lite-sales-v1")
        self.assertEqual(manifest["execution_count"], 1)
        status, _ = self.post_json("/api/run", {"source": "", "task_id": "stockinette-swatch-v1", "session_id": session_id})
        self.assertEqual(status, 400)

    def test_dataset_and_preview_csp(self):
        with urlopen(self.base_url + "/sales-data.json") as response:
            self.assertEqual(len(json.load(response)), 18)
        with urlopen(self.base_url + "/vega-preview.html") as response:
            self.assertIn("'unsafe-eval'", response.headers["Content-Security-Policy"])
        with urlopen(self.base_url + "/") as response:
            self.assertNotIn("'unsafe-eval'", response.headers["Content-Security-Policy"])


if __name__ == "__main__":
    unittest.main()
