"""Recover sequential study progress from saved submission and trace artifacts."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path

from study_tasks import DSL_TASK_CATALOG, TASK_DSL
from trace_store import _require_safe_id


def _scope(participant_id, recruitment):
    _require_safe_id(participant_id, "participant_id")
    if recruitment is not None and not isinstance(recruitment, dict):
        raise ValueError("recruitment must be an object")
    fields = []
    for key in ("study_id", "prolific_session_id"):
        value = (recruitment or {}).get(key, "")
        if not isinstance(value, str) or len(value) > 256:
            raise ValueError("Invalid recruitment metadata")
        fields.append(value)
    return participant_id, *fields


def _json(path):
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Saved artifact must be an object")
    return value


def _timestamp(value):
    if not isinstance(value, str):
        raise ValueError("Missing saved timestamp")
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Saved timestamp must include a timezone")
    return result


def _completion(session_dir, manifest):
    if manifest.get("status") != "completed" or not manifest.get("passed_submission_id"):
        return None
    submission_id = _require_safe_id(manifest["passed_submission_id"], "submission_id")
    submission = _json(session_dir / "submissions" / f"{submission_id}.json")
    execution_id = _require_safe_id(submission.get("execution_id"), "execution_id")
    execution = _json(session_dir / "executions" / execution_id / "result.json")
    task_id = manifest["task_id"]
    if not (
        submission.get("passed") is True
        and submission.get("check", {}).get("passed") is True
        and submission.get("check", {}).get("task_id") == task_id
        and execution.get("status") == "succeeded"
        and execution.get("compiler_result", {}).get("ok") is True
        and execution.get("compiler_result", {}).get("check", {}).get("passed") is True
        and execution.get("compiler_result", {}).get("check", {}).get("task_id") == task_id
        and submission.get("session_id") == manifest.get("session_id")
        and submission.get("submission_id") == submission_id
        and execution.get("session_id") == manifest.get("session_id")
        and execution.get("execution_id") == execution_id
    ):
        return None
    final_source = (session_dir / "code" / "source-final.ks").read_text(encoding="utf-8")
    execution_source = (session_dir / "executions" / execution_id / "source.ks").read_text(encoding="utf-8")
    state_id = "sha256:" + hashlib.sha256(final_source.encode("utf-8")).hexdigest()
    if not (
        final_source == execution_source
        and state_id == manifest.get("final_code_state_id")
        and state_id == submission.get("code_state_id")
        and state_id == execution.get("code_state_id")
    ):
        return None
    started = _timestamp(manifest.get("started_at"))
    finished = _timestamp(execution.get("finished_at"))
    submitted = _timestamp(submission.get("submitted_at"))
    ended = _timestamp(manifest.get("ended_at"))
    if not started <= finished <= submitted <= ended:
        return None
    return started, ended


def task_progress(store, participant_id, dsl, recruitment=None):
    if not isinstance(dsl, str) or dsl not in DSL_TASK_CATALOG:
        raise ValueError("Unknown DSL")
    scope = _scope(participant_id, recruitment)
    candidates = {}
    for path in Path(store.root).glob("*/manifest.json"):
        try:
            manifest = _json(path)
            task_id = manifest.get("task_id")
            if TASK_DSL.get(task_id) != dsl or _scope(manifest.get("participant_id"), manifest.get("recruitment")) != scope:
                continue
            completed = _completion(path.parent, manifest)
            if completed:
                candidates.setdefault(task_id, []).append(completed)
        except (OSError, ValueError, TypeError, KeyError, AttributeError):
            continue
    tasks = []
    previous_end = None
    prior_complete = True
    for task in DSL_TASK_CATALOG[dsl]["tasks"]:
        eligible = [
            ended for started, ended in candidates.get(task["id"], [])
            if previous_end is None or started >= previous_end
        ] if prior_complete else []
        completed = bool(eligible)
        tasks.append({"id": task["id"], "label": task["label"], "completed": completed, "unlocked": prior_complete})
        prior_complete = prior_complete and completed
        if completed:
            previous_end = min(eligible)
    current = next((task["id"] for task in tasks if not task["completed"]), None)
    return {"dsl": dsl, "tasks": tasks, "current_task_id": current, "next_task_id": current, "completed": current is None}


def assert_task_unlocked(store, participant_id, task_id, recruitment=None):
    if not isinstance(task_id, str) or task_id not in TASK_DSL:
        raise ValueError("Unknown study task")
    progress = task_progress(store, participant_id, TASK_DSL[task_id], recruitment)
    task = next(task for task in progress["tasks"] if task["id"] == task_id)
    if not task["unlocked"]:
        raise ValueError("Complete the preceding task before starting this task")
    return progress
