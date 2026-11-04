"""Shared study task sets selected by a DSL URL path."""

DSL_TASK_CATALOG = {
    "knitscript": {
        "label": "KnitScript",
        "tasks": [
            {"id": "knitscript-plain-v1", "label": "Task 01 — Plain swatch", "description": "Write a KnitScript program from scratch that produces a 10-stitch-wide rectangular stockinette swatch with six complete fabric rows. Use a ten-needle alternating-tuck cast-on followed by two securing knit rows, release the hook, then knit six fabric rows. Finish by taking the carrier out."},
            {"id": "knitscript-ribbed-v1", "label": "Task 02 — Ribbed swatch", "description": "Write a KnitScript program from scratch that produces a 10-stitch-wide, six-row ribbed swatch. Alternate front- and back-bed stitches across the width. Begin with a ten-needle front-bed alternating-tuck cast-on and two securing rows before releasing the hook; transfer alternating stitches to the back bed for the six fabric rows and finish by taking the carrier out."},
            {"id": "knitscript-striped-v1", "label": "Task 03 — Striped swatch", "description": "Write a KnitScript program from scratch that produces a 10-stitch-wide stockinette swatch with two horizontal color sections. Use one yarn carrier for three fabric rows and a second carrier for the following three rows, Begin with a ten-needle alternating-tuck cast-on and two securing rows before releasing the hook. Take each carrier out after its section; the second carrier must be released correctly."},
        ],
    },
    "vega-lite": {
        "label": "Vega-Lite",
        "tasks": [
            {"id": "vega-lite-bar-v1", "label": "Task 01 — Bar chart", "description": "Create a Vega-Lite program from scratch showing total sales by category as a bar chart. Use /sales-data.json, whose fields are month, category and sales. Sum sales within each category and include a chart title and axis titles."},
            {"id": "vega-lite-line-v1", "label": "Task 02 — Line chart", "description": "Create a Vega-Lite program from scratch showing sales over time as a line chart. Use /sales-data.json, whose fields are month, category and sales. Show separate colored lines for Books and Games, exclude Music, and include a chart title and axis titles."},
            {"id": "vega-lite-scatter-v1", "label": "Task 03 — Scatterplot", "description": "Create a Vega-Lite program from scratch showing a scatterplot of month number versus sales. Use /sales-data.json, whose fields are month, category and sales. Derive month number from month, use color to distinguish categories, exclude records with sales below 120, and include a chart title and axis titles."},
        ],
    },
    "idyll": {
        "label": "Idyll",
        "tasks": [
            {"id": "idyll-calculator-v1", "label": "Task 01 — Interactive calculator", "description": "Write an Idyll article from scratch with a quantity slider ranging from 0 to 10. Each item costs 5 dollars. Display the quantity and total cost, updating both when the slider changes."},
            {"id": "idyll-converter-v1", "label": "Task 02 — Unit converter", "description": "Write an Idyll article from scratch with a Celsius temperature input ranging from 0 to 100. Display the corresponding Fahrenheit temperature using Fahrenheit = Celsius × 9 / 5 + 32. Update the displayed result when the input changes."},
            {"id": "idyll-conditional-v1", "label": "Task 03 — Conditional explanation", "description": "Write an Idyll article from scratch with a slider ranging from 0 to 100 and a display of its current value. Show Low for values below 30, Medium for values from 30 through 69, and High for values of 70 or greater. Update the message when the slider changes."},
        ],
    },
    "penrose": {
        "label": "Penrose",
        "tasks": [
            {"id": "penrose-nested-v1", "label": "Task 01 — Nested sets", "description": "Write a Penrose Substance program from scratch declaring sets A, B and C. Specify that A is a subset of B and B is a subset of C. Label all sets. The Domain and Style are supplied."},
            {"id": "penrose-overlap-v1", "label": "Task 02 — Overlapping sets", "description": "Write a Penrose Substance program from scratch declaring sets A, B and C. Specify that A and B intersect, while C is disjoint from both A and B. Label all sets. The Domain and Style are supplied."},
            {"id": "penrose-points-v1", "label": "Task 03 — Points and sets", "description": "Write a Penrose Substance program from scratch declaring disjoint sets A and B and points p and q. Place p inside A and outside B; place q inside B and outside A. Label all objects. The Domain and Style are supplied."},
        ],
    },
}

TASK_DSL = {task["id"]: dsl for dsl, entry in DSL_TASK_CATALOG.items() for task in entry["tasks"]}
LEGACY_TASK_DSL = {
    "stockinette-swatch-v1": "knitscript",
    "vega-lite-sales-v1": "vega-lite",
    "idyll-playground-v1": "idyll",
    "penrose-playground-v1": "penrose",
}


def validate_task_dsl(task_id, dsl):
    if not isinstance(task_id, str):
        raise ValueError("task_id must be a string")
    expected = TASK_DSL.get(task_id) or LEGACY_TASK_DSL.get(task_id)
    if task_id in TASK_DSL and dsl is None:
        raise ValueError("dsl is required for this task")
    if dsl is not None and (not isinstance(dsl, str) or dsl not in DSL_TASK_CATALOG or dsl != expected):
        raise ValueError("Task does not belong to the selected DSL")
