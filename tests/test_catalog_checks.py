import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from catalog_checks import check_knit, check_vega
from vega_task import evaluate_vega_runtime

ROOT = Path(__file__).resolve().parents[1]
PLAIN_SOURCE = """pattern_width = 10;
pattern_height = 6;
c = 1;
with Carrier as c:{
  in Leftward direction:{ tuck Front_Needles[1:pattern_width:2]; }
  in reverse direction:{ tuck Front_Needles[0:pattern_width:2]; }
  in reverse direction:{ knit Loops; }
  in reverse direction:{ knit Loops; }
  releasehook;
  for row in range(pattern_height):{
    in reverse direction:{ knit Loops; }
  }
}
"""
RIB_SOURCE = PLAIN_SOURCE.replace('  releasehook;', '  releasehook;\n  xfer Front_Needles[1:10:2] across;')
STRIPE_SOURCE = PLAIN_SOURCE.replace('pattern_height = 6;', 'pattern_height = 3;') + """with Carrier as 2:{
  in Leftward direction:{ knit Loops; }
  in reverse direction:{ knit Loops; }
  releasehook;
  in reverse direction:{ knit Loops; }
}
"""
KNIT_SOURCES = {'knitscript-plain-v1': PLAIN_SOURCE, 'knitscript-ribbed-v1': RIB_SOURCE, 'knitscript-striped-v1': STRIPE_SOURCE}
VEGA_SPECS = {
    'vega-lite-bar-v1': {'data': {'url': '/sales-data.json'}, 'title': 'Sales by category', 'mark': 'bar', 'encoding': {'x': {'field': 'category', 'type': 'nominal', 'title': 'Category'}, 'y': {'aggregate': 'sum', 'field': 'sales', 'type': 'quantitative', 'title': 'Total sales'}}},
    'vega-lite-line-v1': {'data': {'url': '/sales-data.json'}, 'title': 'Sales over time', 'transform': [{'filter': {'field': 'category', 'oneOf': ['Books', 'Games']}}], 'mark': 'line', 'encoding': {'x': {'field': 'month', 'type': 'temporal', 'title': 'Month'}, 'y': {'field': 'sales', 'type': 'quantitative', 'title': 'Sales'}, 'color': {'field': 'category', 'type': 'nominal'}}},
    'vega-lite-scatter-v1': {'data': {'url': '/sales-data.json'}, 'title': 'Monthly sales', 'transform': [{'filter': 'datum.sales >= 120'}, {'calculate': 'utcmonth(toDate(datum.month)) + 1', 'as': 'month_number'}], 'mark': 'point', 'encoding': {'x': {'field': 'month_number', 'type': 'quantitative', 'title': 'Month number'}, 'y': {'field': 'sales', 'type': 'quantitative', 'title': 'Sales'}, 'color': {'field': 'category', 'type': 'nominal'}}},
}


def compile_knit(source):
    with tempfile.TemporaryDirectory() as temporary:
        result = subprocess.run([str(ROOT / '.venv/bin/python'), str(ROOT / 'compiler_worker.py')], input=source, text=True, capture_output=True, cwd=temporary, timeout=25, check=True)
        return json.loads(result.stdout)


class CatalogCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.knit = {task: compile_knit(source) for task, source in KNIT_SOURCES.items()}
        cls.vega = {task: evaluate_vega_runtime(json.dumps(spec)) for task, spec in VEGA_SPECS.items()}

    def test_all_six_canonical_programs_pass_real_execution(self):
        for task, result in self.knit.items():
            with self.subTest(task=task):
                self.assertTrue(result['ok'], result)
                self.assertTrue(check_knit(result, task)['passed'], check_knit(result, task))
        for task, result in self.vega.items():
            with self.subTest(task=task):
                self.assertTrue(result['ok'], result)
                self.assertTrue(check_vega(result, task)['passed'], check_vega(result, task))

    def test_wrong_knit_width_rows_beds_and_carrier_patterns_fail(self):
        for task in KNIT_SOURCES:
            with self.subTest(task=task):
                wrong = compile_knit(KNIT_SOURCES[task].replace('pattern_width = 10;', 'pattern_width = 8;'))
                self.assertFalse(check_knit(wrong, task)['passed'])
        self.assertFalse(check_knit(self.knit['knitscript-plain-v1'], 'knitscript-ribbed-v1')['passed'])
        self.assertFalse(check_knit(self.knit['knitscript-plain-v1'], 'knitscript-striped-v1')['passed'])
        self.assertFalse(check_knit(compile_knit(PLAIN_SOURCE.replace('pattern_height = 6;', 'pattern_height = 5;')), 'knitscript-plain-v1')['passed'])

    def test_compiler_failure_never_passes(self):
        for task in KNIT_SOURCES:
            self.assertFalse(check_knit({'ok': False}, task)['passed'])
        for task in VEGA_SPECS:
            self.assertFalse(check_vega({'ok': False}, task)['passed'])

    def test_wrong_chart_values_types_or_missing_titles_fail(self):
        for task, original in VEGA_SPECS.items():
            with self.subTest(task=task):
                for mutation in ['data', 'mark', 'title']:
                    spec = copy.deepcopy(original)
                    if mutation == 'data':
                        spec['data'] = {'values': [{'category': 'Books', 'sales': 0, 'month': '2025-01-01'}]}
                    elif mutation == 'mark':
                        spec['mark'] = 'text'
                    else:
                        spec.pop('title')
                    self.assertFalse(check_vega(evaluate_vega_runtime(json.dumps(spec)), task)['passed'])

    def test_wrong_filter_and_aggregation_fail(self):
        spec = copy.deepcopy(VEGA_SPECS['vega-lite-bar-v1'])
        spec['encoding']['y']['aggregate'] = 'mean'
        self.assertFalse(check_vega(evaluate_vega_runtime(json.dumps(spec)), 'vega-lite-bar-v1')['passed'])
        for task in ['vega-lite-line-v1', 'vega-lite-scatter-v1']:
            spec = copy.deepcopy(VEGA_SPECS[task])
            spec['transform'] = [transform for transform in spec['transform'] if 'filter' not in transform]
            self.assertFalse(check_vega(evaluate_vega_runtime(json.dumps(spec)), task)['passed'])

    def test_invisible_or_identically_colored_marks_fail(self):
        for task in ['vega-lite-line-v1', 'vega-lite-scatter-v1']:
            spec = copy.deepcopy(VEGA_SPECS[task])
            spec['encoding']['color']['scale'] = {'range': ['red']}
            self.assertFalse(check_vega(evaluate_vega_runtime(json.dumps(spec)), task)['passed'])
        spec = copy.deepcopy(VEGA_SPECS['vega-lite-scatter-v1'])
        spec['mark'] = {'type': 'point', 'size': 0}
        self.assertFalse(check_vega(evaluate_vega_runtime(json.dumps(spec)), 'vega-lite-scatter-v1')['passed'])

    def test_horizontal_bars_and_precomputed_aggregation_are_valid(self):
        spec = copy.deepcopy(VEGA_SPECS['vega-lite-bar-v1'])
        spec['encoding']['x'], spec['encoding']['y'] = spec['encoding']['y'], spec['encoding']['x']
        self.assertTrue(check_vega(evaluate_vega_runtime(json.dumps(spec)), 'vega-lite-bar-v1')['passed'])
        spec = copy.deepcopy(VEGA_SPECS['vega-lite-bar-v1'])
        spec['transform'] = [{'aggregate': [{'op': 'sum', 'field': 'sales', 'as': 'total'}], 'groupby': ['category']}]
        spec['encoding']['y'].pop('aggregate')
        spec['encoding']['y']['field'] = 'total'
        self.assertTrue(check_vega(evaluate_vega_runtime(json.dumps(spec)), 'vega-lite-bar-v1')['passed'])


if __name__ == '__main__':
    unittest.main()
