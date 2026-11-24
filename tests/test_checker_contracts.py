import json
from pathlib import Path
import unittest

from server import evaluate_source

CASES = json.loads((Path(__file__).parent / 'fixtures/checker_contracts.json').read_text())


class CheckerContractTests(unittest.TestCase):
    def test_existing_check_payloads_are_unchanged(self):
        for case in CASES:
            with self.subTest(case=case['name']):
                status, result = evaluate_source(case['source'], case['task_id'])
                self.assertEqual(case['status'], status)
                self.assertEqual(case['compiled'], result['ok'])
                self.assertEqual(case['check'], result['check'])


if __name__ == '__main__':
    unittest.main()
