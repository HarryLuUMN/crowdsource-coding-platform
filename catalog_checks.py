"""Compatibility imports for the per-task KnitScript and Vega-Lite checkers."""

from programming_checkers import check_task


def check_knit(result, task_id):
    return check_task(task_id, result)


def check_vega(result, task_id):
    return check_task(task_id, result)
