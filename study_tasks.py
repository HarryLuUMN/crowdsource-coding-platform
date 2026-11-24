"""Shared study task sets selected by a DSL URL path."""

IDYLL_EXPLORER_ARTICLE = """# Exploring Sales Across Categories

Monthly sales can vary considerably across product categories. A useful comparison starts by choosing which records to examine.

## Choose Your View

Select a product category and a minimum sales value. A record should appear only when it matches both selections.

## Inspect the Records

The table shows the records included in the current selection. The chart presents those same records over time, making individual observations easier to compare.

## Summarize the Selection

The number of matching records, total sales, and average sales describe the current selection. These summaries should change whenever either control changes.

## When Nothing Matches

Some combinations of category and minimum sales may produce no matching records. In that case, the article should clearly explain that there are no results."""

IDYLL_STORY_ARTICLE = """# A Closer Look at Monthly Sales

A single chart can answer different questions depending on what we choose to emphasize. Scroll through this article to examine the same sales data from four perspectives.

## 1. See the Whole Picture

Begin with the monthly sales trends for all product categories. Comparing the lines reveals how the categories change over the same period.

## 2. Focus on One Category

Choose a category to examine more closely. Emphasize its sales trend while keeping the other categories visible as context.

## 3. Compare with the Monthly Average

Compare the selected category with the average sales across all categories in each month. The average provides a reference for identifying months when the selected category performs above or below the broader pattern.

## 4. Find Months Above a Threshold

Choose a sales threshold and identify the selected category's months that exceed it. Changing the category or threshold should immediately update the highlighted observations.

## Revisit the Story

Scroll back to an earlier section to revisit that perspective. Your category and threshold selections should remain available throughout the article."""

IDYLL_EXPLORER_DESCRIPTION = """Build an interactive sales explorer using the supplied article below. Copy the article into the editor and add the interaction code; do not write new article prose. Use the fixed sales dataset with [data name:"sales" source:"sales-data.json" /]. It contains month, category, and sales for Books, Games, and Music.

Controls: add a Select bound to a category variable, with options All, Books, Games, Music (initially All), and a Range bound to a minimum-sales variable, min:0 max:500 step:10 (initially 0). Show both controls and keep them enabled.

Linked views: filter records by BOTH the selected category (All includes every category) and sales greater than or equal to the minimum. Pass the same filtered records to a Table and a point Chart with x:"month" y:"sales" color:"category". Both views must update whenever either control changes.

Summaries: use Display components with role:"count", role:"total", and role:"average" for matching-record count, sales total, and mean sales. Show the mean to two decimal places. With no matches, show count 0, total 0, average —, empty table/chart data, and exactly one visible message No matching records. Hide that message whenever matches exist.

Use the provided article headings to place controls, views, and summaries in the corresponding sections. Use Run to test multiple control combinations, inspect Compiled Article and Checks, and Submit when all requirements pass. Documentation explains the supplied components and supported array expressions."""

IDYLL_STORY_DESCRIPTION = """Build a scroll-driven sales story using the supplied article below. Copy the complete article and add the interaction code; you do not need to write article prose. Load [data name:"sales" source:"sales-data.json" /].

Layout: use one Scroller with step bound to a mutable variable initially 0. Wrap the four numbered article sections in Step components with index:0, index:1, index:2, index:3. Place the shared Chart and controls inside one Pinned component in the same Scroller. The visualization stays on the right and visible while the article scrolls. A step becomes active when its top passes 40% of the preview viewport, including on upward scrolling.

Controls: inside Pinned, show an enabled Select with Books, Games, Music (initially Books) and an enabled Range min:0 max:500 step:10 (initially 150). Keep both selections when scrolling and update the current view immediately when either changes. Do not reset the current step when editing controls.

Chart: use type:"line" x:"month" y:"sales" color:"category" throughout. Step 0 (Overview): all records, no focus, reference, or highlights. Step 1 (Focus): all records, focus the selected category and fade the others. Step 2 (Average): only the selected category's records, with a reference array containing the mean sales across ALL categories for each month. Step 3 (Threshold): only the selected category's records, highlighting exactly those with sales strictly greater than the selected threshold; no reference line. Supply empty reference/highlight arrays when not needed.

Use a Display with role:"stage" inside Pinned to show Overview, Focus, Average, or Threshold for the current step. Compute filtered data, monthly averages, and highlights in your own derived expressions; the components only render the values you supply. Test forward and backward scrolling and controls at different stages, then Submit when all Checks pass."""


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
            {"id": "idyll-explorer-v2", "label": "Task 02 — Linked sales explorer", "description": IDYLL_EXPLORER_DESCRIPTION, "article": IDYLL_EXPLORER_ARTICLE},
            {"id": "idyll-story-v2", "label": "Task 03 — Scroll-driven sales story", "description": IDYLL_STORY_DESCRIPTION, "article": IDYLL_STORY_ARTICLE},
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
