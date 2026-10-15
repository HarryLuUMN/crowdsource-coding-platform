import copy
import unittest

from scripts.label_vega_traces import apply_detections


class VegaLabelMappingTests(unittest.TestCase):
    def setUp(self):
        self.dataset = {
            'codebook': [{'codes': [{'id': 'DOC_FIRST'}, {'id': 'WRONG_TOKEN'}]}],
            'steps': [{'index': 0, 'rawStepIndices': [0, 1]}, {'index': 1, 'rawStepIndices': [2]}],
            'rawSteps': [{'sourceSteps': [10]}, {'sourceSteps': [11]}, {'sourceSteps': [12]}],
            'annotations': {'1': ['MANUAL']}, 'ruleDecisions': {},
            'trace': {'dataNote': 'No property annotations applied.'},
        }
        self.report = {
            'rule_version': 'test', 'coverage': {},
            'detections': [
                {'property': 'DOC_FIRST', 'status': 'supported', 'steps': [0, 1], 'reason': 'test'},
                {'property': 'WRONG_TOKEN', 'status': 'candidate', 'steps': [2], 'reason': 'test'},
            ],
        }

    def test_supported_labels_and_pending_candidates(self):
        original = copy.deepcopy(self.dataset)
        output = apply_detections(self.dataset, self.report)
        self.assertEqual(output['annotations'], {'1': ['MANUAL'], '0': ['DOC_FIRST']})
        self.assertEqual(output['rules']['detections'][1]['status'], 'candidate')
        self.assertEqual(output['rules']['detections'][0]['evidence']['events'], [10, 11])
        self.assertEqual(self.dataset, original)
        self.assertEqual(output['steps'], original['steps'])
        self.assertEqual(output['rawSteps'], original['rawSteps'])
        self.assertEqual(apply_detections(output, self.report), output)

    def test_rejected_rule_and_unknown_code_preserved(self):
        self.dataset['ruleDecisions']['0:DOC_FIRST'] = 'rejected'
        self.report['detections'].append({'property': 'NOT_IN_CODEBOOK', 'status': 'supported', 'steps': [2], 'reason': 'test'})
        output = apply_detections(self.dataset, self.report)
        self.assertEqual(output['annotations'], self.dataset['annotations'])
        self.assertEqual(len(output['automaticLabeling']['unmapped']), 1)


if __name__ == '__main__':
    unittest.main()
