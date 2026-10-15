import unittest

from semantic_step_processor import SemanticStepProcessor


class SemanticStepProcessorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.processor = SemanticStepProcessor()

    def test_assignment_insert_modify_delete(self):
        for before, after, expected in [
            ("", "width=10;", "declaration_assignment"),
            ("width=10;", "width=11;", "small_span_modification"),
            ("width=10;", "", "local_deletion"),
        ]:
            self.assertEqual(self.processor.compare(before, after)["unitType"], expected)

    def test_native_comments_and_strings(self):
        self.assertEqual(self.processor.compare("width=10;", "width = 10; // note\n")["rule"], "E2")
        self.assertFalse(self.processor.analyze("width=10; # not a KnitScript comment")["valid"])
        result = self.processor.compare("", 'print "a;{b}";')
        self.assertEqual(result["unitType"], "expression_operation")

    def test_compound_and_invalid_are_not_synthetic_steps(self):
        self.assertEqual(self.processor.compare("", "a=1;b=2;")["unitType"], "compound_edit")
        block = "with Carrier as c1:{ in Leftward direction:{ knit Loops; } }"
        self.assertEqual(self.processor.compare("", block)["rule"], "E4")
        self.assertEqual(self.processor.compare("", "with Carrier as c1:{}")["rule"], "E1")

    def test_instruction_is_one_unit_not_just_its_first_expression(self):
        before = "in Leftward direction:{knit Front_Needles[0:10];}"
        after = before.replace("10", "11")
        result = self.processor.compare(before, after)
        self.assertEqual(result["unitType"], "small_span_modification")
        self.assertEqual(result["unit"]["production"], "instruction_assignment")

    def test_separate_leaf_edits_do_not_collapse_into_parent(self):
        self.assertEqual(self.processor.compare("a=1;b=2;", "a=3;b=4;")["rule"], "E7")

    def test_group_incomplete_typing_and_stop_at_run(self):
        events = [
            {"event": "editor.edit", "source": "width=", "elapsedMs": 0},
            {"event": "editor.edit", "source": "width=1;", "elapsedMs": 100},
            {"event": "editor.edit", "source": "width=10;", "elapsedMs": 200},
            {"event": "run.requested", "elapsedMs": 300},
        ]
        output = self.processor.process_events(events)
        self.assertEqual(output["steps"][0]["rawStepIndices"], [0, 1, 2])
        self.assertEqual(output["steps"][1]["event"], "run.requested")
        self.assertEqual(output["rawSteps"], events)

    def test_time_boundary_and_snapshot_provenance(self):
        output = self.processor.process_events([
            {"event": "editor.edit", "source": "a=1;", "elapsedMs": 0},
            {"event": "editor.edit", "source": "a=2;", "elapsedMs": 6000},
            {"event": "compiler.source_snapshot", "source": "a=3;", "elapsedMs": 7000},
        ])
        self.assertEqual(len(output["steps"]), 4)
        self.assertEqual(output["steps"][2]["evidence"], "snapshot_difference")


if __name__ == "__main__":
    unittest.main()
