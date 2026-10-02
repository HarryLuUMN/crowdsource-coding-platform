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

    def test_earlier_reviews_preserve_steps_and_supported_labels(self) -> None:
        for prefix, count, annotated in (("5f427", 78, 29), ("691de", 52, 23)):
            dataset = json.loads((ROOT / "annotation_data" / f"{prefix}.json").read_text())
            review = json.loads((ROOT / "annotation_data" / f"{prefix}-review.json").read_text())
            self.assertEqual(count, len(dataset["steps"]))
            self.assertEqual(list(range(count)), [s["index"] for s in dataset["steps"]])
            self.assertEqual(review["session"], dataset["trace"]["id"])
            self.assertEqual(annotated, len(review["annotations"]))
            supported = {c["id"] for g in dataset["codebook"][:2] for c in g["codes"]}
            for index, labels in review["annotations"].items():
                self.assertLess(int(index), count)
                self.assertTrue(set(labels) <= supported)
                if "VALID_WRONG_OUTPUT" in labels:
                    self.assertIn("does not pass all task checks", dataset["steps"][int(index)]["note"])
            self.assertTrue(any(s["source"].strip() for s in dataset["steps"]))

    def test_67658_review_retains_candidate_uncertainty(self) -> None:
        review = json.loads((ROOT / "annotation_data" / "67658-review.json").read_text())
        self.assertEqual("6765829a949d1203926e1ade", review["participant"])
        self.assertEqual(31, len(review["review"]))
        self.assertEqual(88, len(review["ruleDecisions"]))
        self.assertEqual("rejected", review["ruleDecisions"]["102:LOCAL_REVISION"])
        self.assertEqual("uncertain", review["ruleDecisions"]["512:PASTE_DOC"])
        self.assertEqual("confirmed", review["ruleDecisions"]["273:PASTE_DOC"])
        self.assertEqual(set(review["ruleDecisions"]), set(review["ruleReviewNotes"]))
        supported = {c["id"] for g in self.dataset["codebook"][:2] for c in g["codes"]}
        for entry in review["review"].values():
            self.assertTrue(set(entry["codes"]) <= supported)
            self.assertTrue(entry["reason"])


if __name__ == "__main__":
    unittest.main()
