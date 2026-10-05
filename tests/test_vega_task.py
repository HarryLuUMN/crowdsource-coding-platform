import copy
import json
import unittest

from vega_task import SALES_DATA, evaluate_vega


class VegaTaskTests(unittest.TestCase):
    def setUp(self):
        self.spec = {
            "data": {"url": "/sales-data.json"}, "mark": "line", "title": "Monthly sales",
            "encoding": {
                "x": {"field": "month", "type": "temporal", "title": "Month"},
                "y": {"field": "sales", "type": "quantitative", "title": "Sales"},
                "color": {"field": "category", "type": "nominal"},
                "tooltip": [{"field": field} for field in ("month", "category", "sales")],
                "opacity": {"condition": {"param": "pick", "value": 1}, "value": 0.2},
            },
            "params": [{"name": "pick", "select": {"type": "point", "fields": ["category"]}, "bind": "legend"}],
        }

    def evaluate(self, spec=None):
        return evaluate_vega(json.dumps(self.spec if spec is None else spec))

    def test_complete_chart(self):
        result = self.evaluate()
        self.assertTrue(result["ok"], result["error"])
        self.assertTrue(result["check"]["passed"])
        self.assertEqual(len(SALES_DATA), 18)

    def test_missing_requirement(self):
        for channel in ("color", "tooltip", "opacity"):
            spec = copy.deepcopy(self.spec)
            del spec["encoding"][channel]
            self.assertFalse(self.evaluate(spec)["check"]["passed"])

    def test_legend_must_be_bound_to_same_parameter(self):
        self.spec["encoding"]["opacity"]["condition"]["param"] = "unbound"
        self.assertFalse(self.evaluate()["check"]["passed"])

    def test_legend_selection_by_color_encoding(self):
        self.spec["params"][0]["select"] = {"type": "point", "encodings": ["color"]}
        self.assertTrue(self.evaluate()["check"]["passed"])

    def test_bad_json_and_bad_shapes(self):
        for source in ("", "{", "[]", '{"data":{"url":"/sales-data.json"},"encoding":[]}'):
            self.assertFalse(evaluate_vega(source)["ok"])

    def test_external_data_and_transforms_rejected(self):
        self.spec["data"]["url"] = "https://example.com/data.json"
        self.assertFalse(self.evaluate()["ok"])
        self.spec["data"] = {"url": "/sales-data.json"}
        self.spec["transform"] = [{"filter": "false"}]
        self.assertFalse(self.evaluate()["ok"])

    def test_runtime_compilation_error(self):
        self.spec["encoding"]["opacity"]["condition"] = {"test": "notAFunction(datum.sales)", "value": 1}
        self.assertFalse(self.evaluate()["ok"])


if __name__ == "__main__":
    unittest.main()
