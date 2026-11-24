"""Check declared Penrose objects and rendered circle relationships."""
import math

from .results import make_test, summarize


def diagram_checks(result, task_id, required, relationships):
    evidence = result.get("evidence") or {}
    objects, labels, shapes = [evidence.get(key, {}) for key in ("objects", "labels", "shapes")]
    predicates = {(item["name"], tuple(item["args"])) for item in evidence.get("predicates", [])}
    declared = result.get("ok") and all(objects.get(name) == kind for name, kind in required.items())
    tests = [
        make_test("objects", "Required typed objects", declared, "Declare all requested sets and points with the required names."),
        make_test("labels", "Labels on all requested objects", declared and all(str(labels.get(name, "")).strip() for name in required), "Label every requested object."),
    ]
    tests.extend(relation_test(name, first, second, declared, predicates, shapes) for name, first, second in relationships)
    return summarize(task_id, tests)


def relation_test(name, first, second, declared, predicates, shapes):
    present = (name, (first, second)) in predicates or (name in {"Disjoint", "Intersecting"} and (name, (second, first)) in predicates)
    valid = False
    try:
        a, b = shapes[first], shapes[second]
        distance = math.dist(a["center"], b["center"])
        ra, rb = a["radius"], b["radius"]
        if all(math.isfinite(value) for value in [distance, ra, rb]) and ra > 0 and rb > 0:
            if name in {"Subset", "In"}:
                valid = distance + ra <= rb + 0.5
            elif name in {"Disjoint", "NotIn"}:
                valid = distance >= ra + rb - 0.5
            elif name == "Intersecting":
                valid = abs(ra - rb) + 0.5 < distance < ra + rb - 0.5
    except (KeyError, TypeError, ValueError):
        pass
    return make_test(f"{name}-{first}-{second}", f"{name}({first}, {second})", declared and present and valid, "Specify this relationship and ensure the rendered diagram satisfies it; remove conflicting relationships if necessary.")
