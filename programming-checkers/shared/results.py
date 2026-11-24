"""Stable formatting for task checker responses."""


def make_test(key, label, passed, message):
    return {
        "id": key,
        "label": label,
        "passed": bool(passed),
        "message": "Requirement satisfied." if passed else message,
    }


def summarize(task_id, tests):
    count = sum(bool(test["passed"]) for test in tests)
    return {
        "task_id": task_id,
        "passed": bool(tests) and count == len(tests),
        "passed_count": count,
        "total_count": len(tests),
        "tests": tests,
    }
