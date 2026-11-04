import json
import tempfile
import unittest
from pathlib import Path

from study_progress import assert_task_unlocked, task_progress
from study_tasks import DSL_TASK_CATALOG
from trace_store import TraceStore, utc_now


class StudyProgressTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.store = TraceStore(Path(self.directory.name))
        self.identity = {"source": "prolific", "study_id": "study-one", "prolific_session_id": "visit-one"}
        self.tasks = [task["id"] for task in DSL_TASK_CATALOG["idyll"]["tasks"]]

    def tearDown(self):
        self.directory.cleanup()

    def session(self, task=0, participant="person-one", recruitment=None):
        return self.store.create_session(participant, self.tasks[task], initial_source="", recruitment=self.identity if recruitment is None else recruitment)

    def submit(self, session, source="article", passed=True):
        task_id = session["task_id"]
        check = {"task_id": task_id, "passed": passed, "tests": []}
        execution = self.store.record_execution(session["session_id"], source, {"ok": True, "check": check}, utc_now())
        return self.store.record_submission(session["session_id"], source, check, execution["execution_id"])

    def progress(self, recruitment=None, participant="person-one"):
        return task_progress(self.store, participant, "idyll", self.identity if recruitment is None else recruitment)

    def complete(self, task=0):
        session = self.session(task)
        self.submit(session)
        self.store.end_session(session["session_id"], "article")
        return session

    def test_first_task_only_then_persistent_sequential_completion(self):
        self.assertEqual([True, False, False], [task["unlocked"] for task in self.progress()["tasks"]])
        with self.assertRaisesRegex(ValueError, "preceding"):
            assert_task_unlocked(self.store, "person-one", self.tasks[1], self.identity)
        for index in range(3):
            self.complete(index)
            restarted = TraceStore(Path(self.directory.name))
            progress = task_progress(restarted, "person-one", "idyll", self.identity)
            self.assertEqual(index + 1, sum(task["completed"] for task in progress["tasks"]))
            self.assertEqual(self.tasks[index + 1] if index < 2 else None, progress["current_task_id"])
        self.assertTrue(self.progress()["completed"])

    def test_pass_without_final_trace_does_not_unlock(self):
        session = self.session()
        self.submit(session)
        self.assertFalse(self.progress()["tasks"][0]["completed"])
        self.store.end_session(session["session_id"], "different code")
        self.assertFalse(self.progress()["tasks"][0]["completed"])
        self.store.end_session(session["session_id"], "article")
        self.assertTrue(self.progress()["tasks"][0]["completed"])

    def test_failure_and_missing_execution_do_not_unlock(self):
        session = self.session()
        self.submit(session, passed=False)
        self.store.end_session(session["session_id"], "article")
        self.assertFalse(self.progress()["tasks"][0]["completed"])
        passed = self.complete()
        manifest = self.store._read_manifest(passed["session_id"])
        submission_path = self.store.root / passed["session_id"] / "submissions" / (manifest["passed_submission_id"] + ".json")
        submission = json.loads(submission_path.read_text())
        (self.store.root / passed["session_id"] / "executions" / submission["execution_id"] / "result.json").unlink()
        self.assertFalse(self.progress()["tasks"][0]["completed"])

    def test_scope_and_dsl_isolation(self):
        self.complete()
        self.assertFalse(self.progress(participant="person-two")["tasks"][0]["completed"])
        for key in ["study_id", "prolific_session_id"]:
            self.assertFalse(self.progress(recruitment={**self.identity, key: "different"})["tasks"][0]["completed"])
        self.assertFalse(task_progress(self.store, "person-one", "penrose", self.identity)["tasks"][0]["completed"])

    def test_out_of_order_old_attempt_does_not_count(self):
        second = self.session(1)
        self.complete()
        self.submit(second)
        self.store.end_session(second["session_id"], "article")
        self.assertFalse(self.progress()["tasks"][1]["completed"])

    def test_tampered_timestamp_and_corrupt_manifests_fail_closed(self):
        session = self.complete()
        directory = self.store.root / session["session_id"]
        manifest_path = directory / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["ended_at"] = "2000-01-01T00:00:00Z"
        manifest_path.write_text(json.dumps(manifest))
        (self.store.root / "broken").mkdir()
        (self.store.root / "broken" / "manifest.json").write_text("not-json")
        self.assertFalse(self.progress()["tasks"][0]["completed"])

    def test_invalid_inputs(self):
        for dsl in ["unknown", None, []]:
            with self.assertRaises(ValueError):
                task_progress(self.store, "person-one", dsl, self.identity)
        with self.assertRaises(ValueError):
            self.progress(recruitment={"study_id": []})
        with self.assertRaises(ValueError):
            assert_task_unlocked(self.store, "person-one", "unknown", self.identity)


if __name__ == "__main__":
    unittest.main()
