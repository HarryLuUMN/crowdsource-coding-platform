from functools import lru_cache
from html import escape
from html.parser import HTMLParser
import re
from urllib.parse import quote, unquote, urljoin, urlparse
from urllib.request import urlopen

BASE = "https://mhofmann-khoury.github.io/knit_script/"
HOME_NAVIGATION = (
    '<nav class="documentation-index" aria-label="Documentation sections">'
    '<section><p>Getting Started</p><ul>'
    '<li><a href="/documentation/installation.html">Installation</a></li>'
    '<li><a href="/documentation/quickstart.html">Quick Start</a></li>'
    '</ul></section>'
    '<section><p>Language Guide</p><ul>'
    '<li><a href="/documentation/language_reference.html">Language Reference</a></li>'
    '<li><a href="/documentation/machine_operations.html">Machine Operations</a></li>'
    '</ul></section>'
    '<section><p>API Reference</p><ul>'
    '<li><a href="/documentation/api/knit_script.html">knit_script package</a></li>'
    '</ul></section>'
    '<section><p>Project Information</p><ul>'
    '<li><a href="/documentation/dependencies.html">Dependencies</a></li>'
    '<li><a href="/documentation/related_projects.html">Related Projects</a></li>'
    '<li><a href="/documentation/acknowledgments.html">Acknowledgments</a></li>'
    '</ul></section>'
    '</nav>'
)


def documentation_url(path):
    url = urljoin(BASE, unquote(path))
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc != urlparse(BASE).netloc:
        raise ValueError("Documentation host is fixed")
    if not parsed.path.startswith("/knit_script/") or parsed.query:
        raise ValueError("Outside documentation")
    if not (parsed.path.endswith("/") or parsed.path.endswith(".html")):
        raise ValueError("Only documentation pages are allowed")
    return url


class DocumentationParser(HTMLParser):
    allowed = set("h1 h2 h3 h4 h5 h6 p div section article nav footer ul ol li pre code strong em b i table caption colgroup col thead tbody tr th td blockquote hr br dl dt dd span a figure figcaption kbd samp var sub sup abbr".split())

    def __init__(self, url):
        super().__init__(convert_charrefs=True)
        self.url = url
        self.output = []
        self.blocked = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "head", "iframe", "object", "form"}:
            self.blocked += 1
        if self.blocked or tag not in self.allowed:
            return
        attributes = dict(attrs)
        safe = ""
        if attributes.get("id"):
            safe += f' id="{escape(attributes["id"], quote=True)}"'
        class_names = [name for name in attributes.get("class", "").split() if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", name)]
        if class_names:
            safe += f' class="{escape(" ".join(class_names[:32]), quote=True)}"'
        if tag == "a" and attributes.get("href"):
            try:
                destination = documentation_url(urljoin(self.url, attributes["href"]))
                parsed = urlparse(destination)
                relative = parsed.path.removeprefix("/knit_script/")
                href = "/documentation/" + quote(relative, safe="/")
                if parsed.fragment:
                    href += "#" + quote(parsed.fragment)
                safe += f' href="{escape(href, quote=True)}"'
            except ValueError:
                pass
        self.output.append(f"<{tag}{safe}>")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "head", "iframe", "object", "form"}:
            self.blocked = max(0, self.blocked - 1)
            return
        if not self.blocked and tag in self.allowed:
            self.output.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.blocked:
            self.output.append(escape(data))


@lru_cache(maxsize=128)
def render_documentation(path):
    url = documentation_url(path)
    with urlopen(url, timeout=10) as response:
        if documentation_url(response.url) != url:
            raise ValueError("Unexpected documentation redirect")
        source = response.read(2_000_001)
        if len(source) > 2_000_000:
            raise ValueError("Documentation page too large")
    parser = DocumentationParser(url)
    parser.feed(source.decode("utf-8"))
    navigation = HOME_NAVIGATION if path in {"", "/"} else ""
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<title>KnitScript documentation</title><link rel="stylesheet" href="/documentation.css?v=5">'
            '</head><body><nav><a href="/documentation/">Documentation home</a></nav>'
            + navigation + "".join(parser.output) + '</body></html>').encode("utf-8")
