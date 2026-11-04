"""Bounded subprocess runners for Idyll and Penrose source."""

import json
import subprocess
import time
from http import HTTPStatus
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNTIME_TASKS = {"idyll-playground-v1": "idyll_compile.cjs", "penrose-playground-v1": "penrose_compile.mjs"}


def evaluate_runtime(source, task_id):
    started = time.monotonic()
    status = HTTPStatus.OK
    try:
        completed = subprocess.run(
            ["node", "--max-old-space-size=256", str(ROOT / "scripts" / RUNTIME_TASKS[task_id])],
            input=json.dumps({"source": source}), text=True, capture_output=True,
            cwd=ROOT, timeout=25, check=False,
        )
        if completed.returncode:
            raise RuntimeError("The language runner stopped unexpectedly. Check that its dependencies are installed.")
        result = json.loads(completed.stdout)
        if not isinstance(result, dict) or not isinstance(result.get("ok"), bool):
            raise ValueError("The language runner returned an invalid response.")
        result["stderr"] = completed.stderr[-8000:]
        result["exit_code"] = completed.returncode
    except subprocess.TimeoutExpired:
        status = HTTPStatus.REQUEST_TIMEOUT
        result = {"ok": False, "error": {"type": "Timeout", "message": "Execution exceeded 25 seconds."}}
    except (OSError, ValueError, RuntimeError) as error:
        status = HTTPStatus.INTERNAL_SERVER_ERROR
        result = {"ok": False, "error": {"type": "RunnerError", "message": str(error)}}
    result["duration_ms"] = round((time.monotonic() - started) * 1000)
    result["check"] = {"task_id": task_id, "passed": False, "passed_count": 0, "total_count": 0, "tests": []}
    return status, result
