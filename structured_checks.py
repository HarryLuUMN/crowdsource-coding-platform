"""Compatibility imports for the per-task Idyll and Penrose checkers."""

from programming_checkers import check_task


def check_idyll(source, result, task_id):
    return check_task(task_id, result)


def check_penrose(source, result, task_id):
    return check_task(task_id, result)
