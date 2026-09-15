import unittest

from documentation import DocumentationParser, documentation_url


class DocumentationTests(unittest.TestCase):
    def test_only_fixed_documentation_pages_allowed(self):
        for path in ["https://example.com/", "../", "//example.com/", "x.js", "index.html?q=x", "%2e%2e/"]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                documentation_url(path)
        self.assertTrue(documentation_url("language.html#loops").endswith("language.html#loops"))

    def test_navigation_and_active_content_are_restricted(self):
        parser = DocumentationParser(documentation_url(""))
        parser.feed('<script>alert(1)</script><a href="language.html#loops" target="_top" onclick="bad()">Language</a><a href="https://example.com">External</a><iframe src="x"></iframe><p>Text</p>')
        output = "".join(parser.output)
        self.assertIn('href="/documentation/language.html#loops"', output)
        for unsafe in ["script", "alert", "onclick", "target", "example.com", "iframe"]:
            self.assertNotIn(unsafe, output)
        self.assertIn("<p>Text</p>", output)
