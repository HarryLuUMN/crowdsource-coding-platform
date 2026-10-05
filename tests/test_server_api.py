from __future__ import annotations

import json
import io
import os
import tempfile
import threading
import unittest
from http.cookiejar import CookieJar
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen
from unittest.mock import patch

import server
from tests.test_answer_checker import CORRECT_SOLUTION
from tests.test_compiler import VALID_PROGRAM
from trace_store import TraceStore


class ServerApiTests(unittest.TestCase):
    ADMIN_TOKEN = "test-admin-token-that-is-long-enough"

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.env_patcher = patch.dict(os.environ, {"TRACE_ADMIN_TOKEN": self.ADMIN_TOKEN})
        self.env_patcher.start()
        server._trace_store = TraceStore(Path(self.temp_dir.name))
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.KnitScriptHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.httpd.server_port}"
        self.admin_opener = build_opener(HTTPCookieProcessor(CookieJar()))

    def test_annotation_save_updates_labels_and_preserves_evidence(self) -> None:
        target = Path(self.temp_dir.name) / "67aa5-units.json"
        original = json.loads((server.ANNOTATION_DATA_DIR / target.name).read_text())
        target.write_text(json.dumps(original))
        payload = {"trace": "67aa5", "traceId": original["trace"]["id"], "granularity": original["granularity"], "annotations": {"51": ["VALID_WRONG_OUTPUT"]}, "rawEventAnnotations": {}, "ruleDecisions": {}}
        with patch.object(server, "ANNOTATION_DATA_DIR", target.parent):
            status, response = self.post_json("/api/admin/annotation-save", payload)
            self.assertEqual(200, status)
            saved = json.loads(target.read_text())
            self.assertEqual(payload["annotations"], saved["annotations"])
            self.assertEqual(original["rawSteps"], saved["rawSteps"])
            self.assertEqual(original["steps"], saved["steps"])
            self.assertEqual(original, json.loads((target.parent / response["backup"]).read_text()))
            with patch.object(server.KnitScriptHandler, "_annotation_local", return_value=False):
                self.assertEqual(403, self.post_json("/api/admin/annotation-save", payload)[0])
            payload["annotations"] = {"99999": ["INVALID"]}
            self.assertEqual(400, self.post_json("/api/admin/annotation-save", payload)[0])
            self.assertEqual(saved, json.loads(target.read_text()))

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()
        server._trace_store = None
        self.env_patcher.stop()
        self.temp_dir.cleanup()

    def post_json(self, path: str, payload: dict[str, object]) -> tuple[int, dict[str, object]]:
        request = Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def get_text(self, path: str) -> tuple[int, str]:
        with urlopen(f"{self.base_url}{path}") as response:
            return response.status, response.read().decode("utf-8")

    def admin_request(self, path: str, payload: dict[str, object] | None = None) -> tuple[int, dict[str, object]]:
        request = Request(
            f"{self.base_url}{path}",
            data=json.dumps(payload).encode("utf-8") if payload is not None else None,
            headers={"Content-Type": "application/json"} if payload is not None else {},
            method="POST" if payload is not None else "GET",
        )
        try:
            with self.admin_opener.open(request) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def test_studio_includes_a_tutorial_panel_and_official_documentation_link(self) -> None:
        status, html = self.get_text("/")

        self.assertEqual(200, status)
        self.assertIn('id="tutorialFrame"', html)
        self.assertIn('data-documentation-view="tutorial"', html)
        self.assertIn('id="documentationPanel"', html)
        self.assertIn('src="/documentation/"', html)
        self.assertIn('sandbox="allow-same-origin"', html)
        self.assertIn('data-documentation-view="documentation"', html)

    def test_studio_starts_with_an_empty_editor(self) -> None:
        html_status, html = self.get_text("/")
        script_status, script = self.get_text("/app.js")

        self.assertEqual(200, html_status)
        self.assertEqual(200, script_status)
        self.assertIn("Write a KnitScript program", html)
        self.assertIn("Clear editor", html)
        self.assertIn('const STARTER_SOURCE = "";', script)
        self.assertNotIn("TODO: cast on", script)

    def test_direct_study_access_requires_a_prolific_participant_id(self) -> None:
        html_status, html = self.get_text("/")
        script_status, script = self.get_text("/app.js")

        self.assertEqual(200, html_status)
        self.assertEqual(200, script_status)
        self.assertIn('id="participantDialog"', html)
        self.assertIn('id="participantIdInput"', html)
        self.assertIn('queryParameters.get("preview") === "1"', script)
        self.assertIn('prolificRecruitment.source = "prolific_manual"', script)
        self.assertIn('participantDialog.showModal()', script)
        self.assertIn('history.replaceState', script)

    def test_admin_page_is_available_but_trace_api_requires_login(self) -> None:
        page_status, html = self.get_text("/admin")
        api_status, payload = self.admin_request("/api/admin/sessions")

        self.assertEqual(200, page_status)
        self.assertIn("Programming Trace Dashboard", html)
        self.assertEqual(401, api_status)
        self.assertFalse(payload["ok"])

    def test_reading_dashboard_is_available(self) -> None:
        status, html = self.get_text("/reading-dashboard")

        self.assertEqual(200, status)
        self.assertIn("Reading Trace Dashboard", html)
        self.assertIn('id="timeline"', html)
        self.assertIn('id="documentReplay"', html)
        self.assertIn('sandbox="allow-same-origin"', html)
        self.assertIn("Read-only replay", html)

    def test_annotation_studio_is_available_without_login(self) -> None:
        status, html = self.get_text("/annotation")
        dataset_status, payload = self.admin_request("/api/admin/annotation-dataset/s4")

        self.assertEqual(200, status)
        self.assertIn("Trace Annotation Studio", html)
        self.assertIn('id="annotationMatrix"', html)
        self.assertIn('id="codeSnapshot"', html)
        self.assertIn('id="readingEvidence"', html)
        self.assertEqual(200, dataset_status)
        self.assertTrue(payload["ok"])
        _, config = self.admin_request("/api/admin/annotation-config")
        self.assertFalse(config["readOnly"])
        request = Request(f"{self.base_url}/api/admin/annotation-config", headers={"X-Forwarded-For": "203.0.113.1"})
        with urlopen(request) as response:
            self.assertTrue(json.loads(response.read())["readOnly"])

        login_status, _login = self.admin_request("/api/admin/login", {"token": self.ADMIN_TOKEN})
        dataset_status, dataset = self.admin_request("/api/admin/annotation-dataset/s4")

        self.assertEqual(200, login_status)
        self.assertEqual(200, dataset_status)
        self.assertEqual("6638e8aa3d1f38846080806a", dataset["dataset"]["trace"]["participant"])
        self.assertEqual(57, len(dataset["dataset"]["steps"]))
        self.assertGreater(len(dataset["dataset"]["codebook"]), 0)

    def test_missing_catalogued_trace_loads_from_deployment_and_cache(self) -> None:
        path = "/api/admin/sessions/9da1b0a5-2c84-4720-abac-c8b3a7fa78aa/events?limit=10000"
        payload = {"ok": True, "events": [{"seq": 1, "type": "editor.edit"}]}
        with patch("server.urlopen", return_value=io.BytesIO(json.dumps(payload).encode())) as remote:
            status, actual = self.admin_request(path)
            self.assertEqual(200, status)
            self.assertEqual(payload, actual)
            self.assertEqual(1, remote.call_count)
        with patch("server.urlopen", side_effect=AssertionError("cache should be used")):
            self.assertEqual((200, payload), self.admin_request(path))
        status, _ = self.admin_request("/api/admin/sessions/not-in-catalog")
        self.assertEqual(401, status)

    def test_processed_traces_load_without_local_sessions_or_network(self) -> None:
        with patch("server.urlopen", side_effect=AssertionError("Processed datasets must work offline")):
            for name, count in (("67658", 528), ("67aa5", 646), ("65fda", 865)):
                status, payload = self.admin_request(f"/api/admin/annotation-dataset/{name}")
                self.assertEqual(200, status)
                dataset = payload["dataset"]
                self.assertEqual("syntactic-unit-v2", dataset["granularity"])
                self.assertEqual(count, len(dataset["rawSteps"]))
                self.assertEqual(count, len({i for step in dataset["steps"] for i in step["rawStepIndices"]}))
                self.assertEqual(dataset["rawSteps"][-1]["source"], dataset["steps"][-1]["source"])

    def test_admin_can_login_and_browse_session_events_and_files(self) -> None:
        _status, session_result = self.post_json(
            "/api/sessions",
            {
                "participant_id": "PID-ADMIN-TEST",
                "task_id": "stockinette-swatch-v1",
                "initial_source": "",
                "recruitment": {"source": "prolific", "prolific_pid": "PID-ADMIN-TEST"},
            },
        )
        session_id = session_result["session"]["session_id"]
        self.post_json(
            "/api/events",
            {
                "session_id": session_id,
                "batch_id": "batch-admin",
                "events": [
                    {
                        "seq": 1,
                        "type": "guide.task_viewed",
                        "client_timestamp": "2026-09-01T00:00:00Z",
                        "elapsed_ms": 1,
                        "payload": {},
                    }
                ],
            },
        )

        login_status, _login = self.admin_request("/api/admin/login", {"token": self.ADMIN_TOKEN})
        list_status, sessions = self.admin_request("/api/admin/sessions")
        detail_status, detail = self.admin_request(f"/api/admin/sessions/{session_id}")
        events_status, events = self.admin_request(f"/api/admin/sessions/{session_id}/events?limit=10")
        files_status, files = self.admin_request(f"/api/admin/sessions/{session_id}/files?limit=10")
        file_status, file_payload = self.admin_request(
            f"/api/admin/sessions/{session_id}/file?path={quote('manifest.json')}"
        )

        self.assertEqual(200, login_status)
        self.assertEqual(200, list_status)
        self.assertEqual(1, sessions["summary"]["session_count"])
        self.assertEqual(200, detail_status)
        self.assertEqual(session_id, detail["manifest"]["session_id"])
        self.assertEqual(200, events_status)
        self.assertEqual("guide.task_viewed", events["events"][0]["type"])
        self.assertEqual(200, files_status)
        self.assertGreater(files["total"], 0)
        self.assertEqual(200, file_status)
        self.assertIn(session_id, file_payload["content"])

    def test_admin_file_api_rejects_path_traversal(self) -> None:
        _status, session_result = self.post_json(
            "/api/sessions",
            {"participant_id": "PID-PATH", "task_id": "stockinette-swatch-v1", "initial_source": ""},
        )
        session_id = session_result["session"]["session_id"]
        self.admin_request("/api/admin/login", {"token": self.ADMIN_TOKEN})

        status, payload = self.admin_request(
            f"/api/admin/sessions/{session_id}/file?path={quote('../secret.txt')}"
        )

        self.assertEqual(400, status)
        self.assertFalse(payload["ok"])

    def test_correct_submission_is_rechecked_saved_and_given_completion_url(self) -> None:
        _status, session_result = self.post_json(
            "/api/sessions",
            {
                "participant_id": "PID123",
                "task_id": "stockinette-swatch-v1",
                "initial_source": "starter",
                "recruitment": {
                    "source": "prolific",
                    "prolific_pid": "PID123",
                    "study_id": "STUDY123",
                    "prolific_session_id": "SESSION123",
                },
            },
        )
        session_id = session_result["session"]["session_id"]

        with patch.dict(
            os.environ,
            {"PROLIFIC_COMPLETION_URL": "https://app.prolific.com/submissions/complete?cc=ABC123"},
        ):
            status, result = self.post_json(
                "/api/submit",
                {"session_id": session_id, "source": CORRECT_SOLUTION},
            )

        self.assertEqual(200, status)
        self.assertTrue(result["check"]["passed"])
        self.assertTrue(result["submission"]["passed"])
        self.assertEqual(
            "https://app.prolific.com/submissions/complete?cc=ABC123",
            result["completion_url"],
        )
        submission_path = (
            Path(self.temp_dir.name)
            / session_id
            / "submissions"
            / f"{result['submission']['submission_id']}.json"
        )
        self.assertTrue(submission_path.is_file())

    def test_incorrect_submission_is_saved_without_a_completion_url(self) -> None:
        _status, session_result = self.post_json(
            "/api/sessions",
            {
                "participant_id": "participant-test",
                "task_id": "stockinette-swatch-v1",
                "initial_source": "starter",
            },
        )

        status, result = self.post_json(
            "/api/submit",
            {"session_id": session_result["session"]["session_id"], "source": VALID_PROGRAM},
        )

        self.assertEqual(200, status)
        self.assertTrue(result["ok"])
        self.assertFalse(result["check"]["passed"])
        self.assertFalse(result["submission"]["passed"])
        self.assertNotIn("completion_url", result)

    def test_submission_rejects_a_missing_source_as_a_bad_request(self) -> None:
        _status, session_result = self.post_json(
            "/api/sessions",
            {
                "participant_id": "participant-test",
                "task_id": "stockinette-swatch-v1",
                "initial_source": "starter",
            },
        )

        status, result = self.post_json(
            "/api/submit",
            {"session_id": session_result["session"]["session_id"]},
        )

        self.assertEqual(400, status)
        self.assertFalse(result["ok"])


if __name__ == "__main__":
    unittest.main()
