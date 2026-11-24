import json
from pathlib import Path
import subprocess
import unittest

from vega_task import SALES_DATA

ROOT = Path(__file__).resolve().parents[1]
SOLUTIONS = json.loads((ROOT / 'tests/fixtures/idyll_advanced_solutions.json').read_text())
RUN_CHECK = r'''
const fs = require('fs');
const compile = require('idyll-compiler');
const {check} = require('./scripts/idyll_advanced_check.cjs');
(async () => {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  try {
    const ast = await compile(input.source, {async:true, spellcheck:false});
    const tests = check(ast, input.task, input.data);
    process.stdout.write(JSON.stringify({tests, passed:tests.length > 0 && tests.every(test => test.passed)}));
  } catch (error) {
    process.stdout.write(JSON.stringify({passed:false, error:error.message}));
  }
})();
'''


class AdvancedIdyllChecksTests(unittest.TestCase):
    def evaluate(self, task, source=None, data=None):
        completed = subprocess.run(
            ['node', '--max-old-space-size=128', '-e', RUN_CHECK],
            cwd=ROOT, input=json.dumps({'task':task, 'source':source or SOLUTIONS[task], 'data':data or SALES_DATA}),
            capture_output=True, text=True, timeout=10, check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stderr)
        return json.loads(completed.stdout)

    def assert_rejected(self, task, source):
        result = self.evaluate(task, source)
        self.assertFalse(result['passed'], result)
        return result

    def test_real_compiled_advanced_solutions_pass(self):
        for task in SOLUTIONS:
            with self.subTest(task=task):
                result = self.evaluate(task)
                self.assertTrue(result['passed'], result)

    def test_explorer_requires_both_filters_and_both_views(self):
        task = 'idyll-explorer-v2'
        source = SOLUTIONS[task]
        changes = [
            ('row.sales >= minimum', 'row.sales > minimum'),
            ('&& row.sales >= minimum', '|| row.sales >= minimum'),
            ('(category === "All" || row.category === category) && ', ''),
            ('[Table data:rows /]', '[Table data:sales /]'),
            ('[Chart data:rows', '[Chart data:sales'),
            ('type:"point"', 'type:"line"'),
        ]
        for before, after in changes:
            with self.subTest(change=before):
                self.assert_rejected(task, source.replace(before, after))

    def test_explorer_checks_summary_and_empty_results(self):
        task = 'idyll-explorer-v2'
        source = SOLUTIONS[task]
        changes = [
            ('sum + row.sales', 'sum + row.sales * 2'),
            ('total / rows.length', 'total / sales.length'),
            (' : "—"', ' : 0'),
            ('role:"count" value:`rows.length`', 'role:"count" value:18'),
            ('role:"average" value:average format:".2f"', 'role:"average" value:average format:".0f"'),
            ('rows.length === 0', 'rows.length > 0'),
            ('No matching records.', 'No results.'),
            ('[Conditional if:`rows.length === 0`]No matching records.[/Conditional]', 'No matching records.'),
        ]
        for before, after in changes:
            with self.subTest(change=before):
                self.assert_rejected(task, source.replace(before, after))

    def test_controls_must_be_live_with_requested_options_and_defaults(self):
        for task in SOLUTIONS:
            source = SOLUTIONS[task]
            changes = [
                ('min:0 max:500 step:10', 'min:0 max:500 step:1'),
                ('min:0 max:500 step:10', 'min:0 max:500 step:10 disabled:true'),
                ('[Select value:category', '[Select DISABLED:"yes" value:category'),
                ('[Select value:category', '[Select multiple:true value:category'),
                ('[Select value:category', '[Select value:"Books"'),
                ('"Books", "Games", "Music"', '"Books", "Games"'),
            ]
            for before, after in changes:
                with self.subTest(task=task, change=before):
                    self.assert_rejected(task, source.replace(before, after))
        self.assert_rejected('idyll-explorer-v2', SOLUTIONS['idyll-explorer-v2'].replace('name:"minimum" value:0', 'name:"minimum" value:150'))
        self.assert_rejected('idyll-story-v2', SOLUTIONS['idyll-story-v2'].replace('name:"threshold" value:150', 'name:"threshold" value:0'))

    def test_story_checks_stage_mapping_category_average_and_boundaries(self):
        task = 'idyll-story-v2'
        source = SOLUTIONS[task]
        changes = [
            ('stage < 2 ? sales : selected', 'sales'),
            ('row.category === category', 'row.category === "Books"'),
            ('stage === 1 ? category : ""', '""'),
            ('stage === 2 ?', 'stage === 1 ?'),
            (' / sales.filter(item => item.month === row.month).length', ' / 2'),
            ('row.sales > threshold', 'row.sales >= threshold'),
            ('stage === 3 ? selected.filter', 'stage === 3 ? sales.filter'),
            ('["Overview", "Focus", "Average", "Threshold"][stage]', '"Overview"'),
            ('reference:reference', 'reference:`[]`'),
        ]
        for before, after in changes:
            with self.subTest(change=before):
                self.assert_rejected(task, source.replace(before, after))

    def test_story_requires_scroller_steps_and_pinned_outputs(self):
        task = 'idyll-story-v2'
        source = SOLUTIONS[task]
        changes = [
            ('[Scroller step:stage]', '[Scroller step:0]'),
            ('[Step index:3]', '[Step index:2]'),
            ('[Pinned]', '[div]'),
            ('[Display role:"stage" value:stageName /]', ''),
        ]
        for before, after in changes:
            with self.subTest(change=before):
                self.assert_rejected(task, source.replace(before, after))
        reversed_steps = source.replace('[Step index:0]', '[Step index:99]').replace('[Step index:3]', '[Step index:0]').replace('[Step index:99]', '[Step index:3]')
        self.assert_rejected(task, reversed_steps)
        nested_pinned = source.replace('[/Step]\n[Pinned]', '[Pinned]', 1).replace('[/Pinned]\n[/Scroller]', '[/Pinned]\n[/Step]\n[/Scroller]', 1)
        self.assert_rejected(task, nested_pinned)
        controls = '[Select value:category options:`["Books", "Games", "Music"]` /]'
        self.assert_rejected(task, controls + '\n' + source.replace(controls, ''))

    def test_fixed_data_and_unhidden_outputs_are_required(self):
        task = 'idyll-explorer-v2'
        source = SOLUTIONS[task]
        for before, after in [
            ('source:"sales-data.json"', 'source:"https://example.com/data.json"'),
            ('[Table data:rows /]', '[Table data:rows style:`{display:"none"}` /]'),
            ('[Chart data:rows', '[Chart hidden:true data:rows'),
            ('[Select value:category', '[Select onChange:`category = "Books"` value:category'),
            ('[Table data:rows /]', '[Table data:rows /]\n[Table data:rows /]'),
        ]:
            with self.subTest(change=before):
                self.assert_rejected(task, source.replace(before, after))

    def test_unsafe_calls_prototypes_mutation_and_callback_statements_fail_closed(self):
        task = 'idyll-explorer-v2'
        source = SOLUTIONS[task]
        for expression in [
            'process.exit(93)',
            'globalThis.process.exit(93)',
            'sales.constructor.constructor("return process")()',
            'sales["__proto__"]',
            'sales.map(row => { return row; })',
            'sales.map(row => row.sales = 0)',
            'sales.map(row => row["constructor"])',
            'sales.sort()',
            '(function(){return sales})()',
            'sales.map(Math => Math.abs(-1))',
        ]:
            with self.subTest(expression=expression):
                result = self.assert_rejected(task, source + f'\n[derived name:"unsafe" value:`{expression}` /]')
                self.assertIn('error', result)

    def test_hidden_component_props_and_case_insensitive_html_attributes_fail(self):
        task = 'idyll-explorer-v2'
        source = SOLUTIONS[task]
        self.assert_rejected(task, source + '\n[Conditional if:false][Display value:`missingVariable + 1` /][/Conditional]')
        self.assert_rejected(task, source + '\n[Conditional if:false][Chart data:`[]` label:`{bad:true}` /][/Conditional]')
        for attribute in ['STYLE:"display:none"', 'HIDDEN:"yes"', 'CLASSNAME:"hidden"', 'aria-hidden:true', 'inert:true']:
            self.assert_rejected(task, f'[div {attribute}]\n{source}\n[/div]')

    def test_coercion_and_unbounded_formatting_cannot_bypass_operation_limits(self):
        task = 'idyll-explorer-v2'
        source = SOLUTIONS[task]
        for expression in ['sales + ""', '+sales', 'Math.abs(sales)', 'sales.slice(sales)', 'sales.includes(1, sales)']:
            self.assert_rejected(task, source + f'\n[derived name:"coercion" value:`{expression}` /]')
        self.assert_rejected(task, source.replace('format:".2f"', 'format:"10000000f"'))

    def test_safe_parentheses_and_object_expressions_work(self):
        completed = subprocess.run(['node', '-e', "const e=require('./scripts/idyll_safe_expression.cjs').createEvaluator(name=>{throw Error(name)}); console.log(JSON.stringify([e('(1 + 2)'),e('({month: \"2025-01-01\", sales: (3 * 4)})'),e('[1,2].map(x => (x * 2))')]));"], cwd=ROOT, capture_output=True, text=True, timeout=5)
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertEqual([3, {'month':'2025-01-01','sales':12}, [2,4]], json.loads(completed.stdout))

    def test_derived_dependencies_must_be_declared_before_use(self):
        task = 'idyll-explorer-v2'
        source = SOLUTIONS[task]
        total = '[derived name:"total" value:`rows.reduce((sum, row) => sum + row.sales, 0)` /]'
        average = '[derived name:"average" value:`rows.length ? total / rows.length : "—"` /]'
        result = self.assert_rejected(task, source.replace(total + '\n' + average, average + '\n' + total))
        self.assertIn('Declare dependencies before derived expressions', result['error'])
        for declaration in ['[var name:"snapshot" value:total /]', '[var name:"first" value:second /]\n[var name:"second" value:1 /]']:
            result = self.assert_rejected(task, source + '\n' + declaration)
            self.assertIn('Declare dependencies before derived expressions', result['error'])
        allowed = source + '\n[var name:"first" value:1 /]\n[var name:"second" value:`first + 1` /]'
        self.assertTrue(self.evaluate(task, allowed)['passed'])

    def test_expression_size_and_operation_limits_fail_closed(self):
        task = 'idyll-explorer-v2'
        source = SOLUTIONS[task]
        oversized = '[' + ','.join('0' for _ in range(2050)) + ']'
        self.assert_rejected(task, source + f'\n[derived name:"oversized" value:`{oversized}` /]')
        expensive = 'sales.map(a => sales.map(b => sales.map(c => sales.map(d => a.sales + b.sales + c.sales + d.sales))))'
        result = self.assert_rejected(task, source + f'\n[derived name:"expensive" value:`{expensive}` /]')
        self.assertIn('budget', result['error'])

    def test_alternative_variable_names_and_reference_order_are_allowed(self):
        explorer = SOLUTIONS['idyll-explorer-v2'].replace('minimum', 'cutoff').replace('category', 'chosenCategory')
        explorer = explorer.replace('row.chosenCategory', 'row.category').replace('color:"chosenCategory"', 'color:"category"')
        self.assertTrue(self.evaluate('idyll-explorer-v2', explorer)['passed'])
        story = SOLUTIONS['idyll-story-v2'].replace('stage', 'chapter')
        story = story.replace('role:"chapter"', 'role:"stage"')
        self.assertTrue(self.evaluate('idyll-story-v2', story)['passed'])


if __name__ == '__main__':
    unittest.main()
