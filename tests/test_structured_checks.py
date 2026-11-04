import json
from pathlib import Path
import unittest

from dsl_runtime import evaluate_runtime
from structured_checks import check_idyll, check_penrose

SOLUTIONS = json.loads((Path(__file__).parent / 'fixtures/structured_solutions.json').read_text())


class StructuredChecksTests(unittest.TestCase):
    def evaluate(self, task, source):
        _, result = evaluate_runtime(source, task.split('-')[0] + '-playground-v1')
        checker = check_idyll if task.startswith('idyll') else check_penrose
        return checker(source, result, task), result

    def test_all_six_real_solutions_pass(self):
        for task, source in SOLUTIONS.items():
            with self.subTest(task=task):
                check, result = self.evaluate(task, source)
                self.assertTrue(result['ok'], result)
                self.assertTrue(check['passed'], check)

    def test_idyll_wrong_formula_boundaries_and_missing_control_fail(self):
        cases = [
            ('idyll-calculator-v1', SOLUTIONS['idyll-calculator-v1'].replace('quantity * 5', 'quantity * 3')),
            ('idyll-converter-v1', SOLUTIONS['idyll-converter-v1'].replace('+ 32', '+ 30')),
            ('idyll-conditional-v1', SOLUTIONS['idyll-conditional-v1'].replace('level < 30', 'level < 29')),
            ('idyll-calculator-v1', '[Display value:10 /]'),
            ('idyll-calculator-v1', SOLUTIONS['idyll-calculator-v1'].replace('min:0 max:10', 'min:1 max:10')),
        ]
        for task, source in cases:
            with self.subTest(task=task, source=source):
                self.assertFalse(self.evaluate(task, source)[0]['passed'])

    def test_hardcoded_values_and_unsafe_expressions_do_not_pass(self):
        prefix = '[var name:"q" value:2 /]\n[Range value:q min:0 max:10 /]\n'
        hardcoded = prefix + '\n'.join(f'[Display value:{number} /]' for number in range(51))
        self.assertFalse(self.evaluate('idyll-calculator-v1', hardcoded)[0]['passed'])
        unsafe = prefix + '[Display value:`process.exit(93)` /]'
        check, result = self.evaluate('idyll-calculator-v1', unsafe)
        self.assertTrue(result['ok'])
        self.assertFalse(check['passed'])
        self.assertIn('cannot safely evaluate', check['tests'][-1]['message'])

    def test_penrose_requires_real_relations_and_labels(self):
        for task in ['penrose-nested-v1', 'penrose-overlap-v1', 'penrose-points-v1']:
            source = SOLUTIONS[task]
            self.assertFalse(self.evaluate(task, source.replace('AutoLabel All', ''))[0]['passed'])
        self.assertFalse(self.evaluate('penrose-nested-v1', 'Set A, B, C\n-- Subset(A,B)\n-- Subset(B,C)\nAutoLabel All')[0]['passed'])

    def test_penrose_geometry_must_match_declared_relationship(self):
        task = 'penrose-nested-v1'
        source = SOLUTIONS[task]
        _, result = self.evaluate(task, source)
        result['evidence']['shapes']['A']['radius'] = 10000
        self.assertFalse(check_penrose(source, result, task)['passed'])


if __name__ == '__main__':
    unittest.main()
