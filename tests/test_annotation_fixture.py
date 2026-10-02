from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class AnnotationFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.dataset = json.loads((ROOT / "annotation_data" / "s4.json").read_text())

    def test_fixture_contains_the_curated_6638e_trace(self) -> None:
        self.assertEqual("6638e8aa3d1f38846080806a", self.dataset["trace"]["participant"])
        self.assertEqual(57, self.dataset["trace"]["stepCount"])
        self.assertEqual(57, len(self.dataset["steps"]))
        self.assertEqual(list(range(57)), [step["index"] for step in self.dataset["steps"]])

    def test_fixture_preserves_code_and_marks_reading_precision(self) -> None:
        self.assertIsNotNone(self.dataset["steps"][0]["reading"])
        self.assertIn("viewport coordinates", self.dataset["steps"][0]["reading"]["precision"])
        self.assertTrue(self.dataset["steps"][1]["source"].startswith(";!knitout-2"))
        self.assertEqual(self.dataset["steps"][1]["source"], self.dataset["steps"][2]["source"])

    def test_codebook_ids_are_unique(self) -> None:
        codes = [code for group in self.dataset["codebook"] for code in group["codes"]]
        self.assertEqual(31, len(codes))
        self.assertEqual(len(codes), len({code["id"] for code in codes}))


if __name__ == "__main__":
    unittest.main()
