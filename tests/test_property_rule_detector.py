import copy
import unittest
from unittest.mock import patch

from property_rule_detector import DETECTORS, detect_properties
from semantic_step_processor import SemanticStepProcessor


def step(event, source='', previous=None, payload=None, **extra):
    return dict(event=event, source=source, previousSource=source if previous is None else previous,
                payload=payload or {}, **extra)


class PropertyRuleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.processor = SemanticStepProcessor()

    def detect(self, steps, **options):
        dataset = {'steps': steps, 'annotations': {'0': ['MANUAL']}}
        before = copy.deepcopy(dataset)
        with patch('property_rule_detector.SemanticStepProcessor', return_value=self.processor):
            result = detect_properties(dataset, **options)
        self.assertEqual(dataset, before)
        return result

    def test_opening_reading_series_only(self):
        steps = [step('session.started'), step('guide.open'), step('guide.scroll'),
                 step('editor.edit', 'x=1;', ''), step('guide.open', 'x=1;')]
        detections = self.detect(steps)['detections']
        reading = next(d for d in detections if d['property'] == 'DOC_FIRST')
        self.assertEqual(reading['steps'], [1, 2])
        self.assertNotIn('DOC_FIRST', [d['property'] for d in self.detect(steps[3:])['detections']])

    def test_incomplete_token_only_on_actual_errors(self):
        error = {'error_type': 'SyntaxError', 'error_message': 'unterminated string literal'}
        self.assertIn('INCOMPLETE_TOKEN', [d['property'] for d in self.detect([step('run.failed', payload=error)])['detections']])
        self.assertEqual(self.detect([step('editor.edit', payload=error)])['detections'], [])

    def test_generic_parse_error_does_not_invent_cause(self):
        result = self.detect([step('run.failed', payload={'error_type': 'Parsing_Error'})])
        self.assertEqual(result['detections'], [])
        self.assertEqual(result['coverage']['errors_without_detailed_messages'], [0])

    def test_error_category_patterns(self):
        cases = {
            'WRONG_TOKEN': 'unexpected token #',
            'NON_LANGUAGE': 'unrecognized token @',
            'INCORRECT_VALUE': 'value must be positive',
            'INCORRECT_BINDING': 'No_Declared_Carrier_Error',
            'INCORRECT_DECLARATION': 'duplicate declaration',
            'INCORRECT_REFERENCE': 'invalid reference',
            'INCOMPLETE_STRUCTURE': "Expected: ['{']",
            'INCORRECT_ARRANGEMENT': 'Yarn Inserting Hook must start in a leftward direction',
        }
        for code, diagnostic in cases.items():
            with self.subTest(code=code):
                result = self.detect([step('run.failed', payload={'error_type': 'Error', 'error_message': diagnostic})])
                self.assertIn(code, [d['property'] for d in result['detections']])

    def test_documentation_paste_needs_supplied_example(self):
        steps = [step('editor.paste', 'x=1;', '')]
        self.assertNotIn('PASTE_DOC', [d['property'] for d in self.detect(steps)['detections']])
        result = self.detect(steps, documentation_examples=['x=1;'])
        self.assertIn('PASTE_DOC', [d['property'] for d in result['detections']])

    def test_wrong_output_requires_success(self):
        check = {'passed': False, 'passed_count': 0, 'total_count': 5}
        result = self.detect([step('run.failed', payload={'check': check}), step('run.completed', payload={'check': check})])
        wrong = [d for d in result['detections'] if d['property'] == 'VALID_WRONG_OUTPUT']
        self.assertEqual([d['steps'] for d in wrong], [[1]])

    def test_local_and_incremental_intervals(self):
        steps = [step('run.completed', 'x=1;'), step('editor.edit', 'x=2;', 'x=1;'),
                 step('run.completed', 'x=2;'), step('editor.edit', 'x=2;y=3;', 'x=2;'),
                 step('run.completed', 'x=2;y=3;')]
        codes = {d['property'] for d in self.detect(steps)['detections']}
        self.assertTrue({'LOCAL_REVISION', 'INCREMENTAL'} <= codes)

    def test_paste_sequence_requires_no_intervening_revision(self):
        steps = [step('editor.paste', 'x=1;', ''), step('editor.edit', '', 'x=1;'), step('editor.paste', 'y=2;', '')]
        codes = {d['property'] for d in self.detect(steps)['detections']}
        self.assertTrue({'PASTE_FIRST', 'DELETE_REPASTE'} <= codes)
        steps.insert(1, step('editor.edit', 'x=2;', 'x=1;'))
        self.assertNotIn('DELETE_REPASTE', [d['property'] for d in self.detect(steps)['detections']])

    def test_trials_require_view_and_two_evaluated_revisions(self):
        error = {'error_type': 'SyntaxError'}
        steps = [step('run.failed', 'x=1;', payload=error), step('output.console_viewed', 'x=1;'),
                 step('editor.edit', 'x=2;', 'x=1;'), step('run.failed', 'x=2;', payload=error),
                 step('editor.edit', 'x=3;', 'x=2;'), step('run.failed', 'x=3;', payload=error)]
        self.assertIn('TRIAL_ERROR', [d['property'] for d in self.detect(steps)['detections']])
        steps.pop(1)
        self.assertNotIn('TRIAL_ERROR', [d['property'] for d in self.detect(steps)['detections']])

    def test_progression_is_censored_without_complete_trace(self):
        steps = [step('run.failed', 'x=1', payload={'error_type': 'SyntaxError'}),
                 step('editor.edit', 'x=1;', 'x=1'),
                 step('run.completed', 'x=1;', payload={'check': {'passed': False}})]
        result = self.detect(steps)
        match = next(d for d in result['detections'] if d['property'] == 'SYNTAX_SEMANTICS')
        self.assertEqual(match['status'], 'unknown')
        complete = self.detect(steps, trace_complete=True)
        self.assertEqual(next(d for d in complete['detections'] if d['property'] == 'SYNTAX_SEMANTICS')['status'], 'candidate')

    def test_embedded_results_deduplicated_and_no_challenge_rules(self):
        payload = {'execution_id': 'run1', 'error_type': 'NameError', 'error_message': 'Variable c not in scope'}
        steps = [step('run.requested', runResult={'event': 'run.failed', 'payload': payload}), step('run.failed', payload=payload)]
        result = self.detect(steps)
        self.assertEqual(result['coverage']['evaluations'], 1)
        self.assertEqual([d['property'] for d in result['detections']], ['IDENTIFIER_ISSUE'])
        self.assertEqual(len(DETECTORS), 23)


if __name__ == '__main__':
    unittest.main()
