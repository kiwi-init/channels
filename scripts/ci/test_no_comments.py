from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from no_comments import Finding, check, css_comment_lines, js_comment_lines, py_findings


def git(repo: str, *args: str) -> None:
    subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=True)


def write(repo: str, path: str, text: str) -> None:
    full = os.path.join(repo, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        f.write(text)


class JsComments(unittest.TestCase):
    def test_line_and_block(self) -> None:
        src = "const a = 1 // why\n/* one\n two */\nconst b = 2\n"
        self.assertEqual(js_comment_lines(src), {1, 2, 3})

    def test_directives_are_comments(self) -> None:
        src = "// @ts-expect-error\nconst a: number = 'x'\nconst b = 1 /* oxlint-disable-line */\n"
        self.assertEqual(js_comment_lines(src), {1, 3})

    def test_strings_are_not_comments(self) -> None:
        src = "const u = 'https://x.dev/a'\nconst v = \"/* no */\"\nconst w = `// ${'//'} ${x /* yes */}`\n"
        self.assertEqual(js_comment_lines(src), {3})

    def test_template_nesting(self) -> None:
        src = "const a = `${`${b}`}//`\nconst c = 1 // here\n"
        self.assertEqual(js_comment_lines(src), {2})

    def test_regex_and_division(self) -> None:
        src = "const r = /\\/\\/[/*]/g\nconst d = a / b / c\nconst e = x.replace(/\\/\\//, '')\nreturn /a/.test(s) // end\n"
        self.assertEqual(js_comment_lines(src), {4})

    def test_jsx(self) -> None:
        src = "const v = (\n  <a href=\"http://x\">\n    {/* note */}\n    see https://kiwi.dev\n  </a>\n)\n"
        self.assertEqual(js_comment_lines(src), {3})


class CssComments(unittest.TestCase):
    def test_css(self) -> None:
        src = "a { content: \"/* no */\"; }\n/* yes\n   too */\nb { background: url(http://x/y.png); }\n"
        self.assertEqual(css_comment_lines(src), {2, 3})


class PyComments(unittest.TestCase):
    def test_comments_and_directives(self) -> None:
        src = "#!/usr/bin/env python3\nx = 1  # type: ignore\ny = '# not this'\n# noqa\n"
        self.assertEqual([f.line for f in py_findings(src, "a.py", frozenset())], [2, 4])

    def test_docstrings(self) -> None:
        src = 'def f() -> None:\n    """Two\n    lines."""\n\n\nclass C:\n    def g(self) -> int:\n        "one"\n        return 1\n'
        found = py_findings(src, "a.py", frozenset())
        self.assertEqual([(f.line, f.what) for f in found], [(2, "docstring of f"), (3, "docstring of f"), (8, "docstring of C.g")])

    def test_allowed_docstring(self) -> None:
        src = 'def f() -> None:\n    """kept"""\n'
        self.assertEqual(py_findings(src, "pkg/a.py", frozenset({"pkg/a.py::f"})), [])


class AddedLinesOnly(unittest.TestCase):
    def test_only_added_lines_fail(self) -> None:
        with tempfile.TemporaryDirectory() as repo:
            git(repo, "init", "-q", "-b", "main")
            git(repo, "config", "user.email", "t@example.com")
            git(repo, "config", "user.name", "t")
            write(repo, "src/a.ts", "// old\nconst a = 1\n")
            write(repo, "notes.md", "# title\n")
            git(repo, "add", ".")
            git(repo, "commit", "-q", "-m", "base")
            write(repo, "src/a.ts", "// old\nconst a = 2 // new\nconst b = 3\n")
            write(repo, "src/b.css", "/* new */\n")
            write(repo, "tools/c.py", "x = 1\n")
            write(repo, "notes.md", "# title\n<!-- md is not checked -->\n")
            git(repo, "add", ".")
            git(repo, "commit", "-q", "-m", "head")
            found = check(repo, "HEAD^1", "HEAD", frozenset())
            self.assertEqual(found, [Finding("src/a.ts", 2, "comment"), Finding("src/b.css", 1, "comment")])


if __name__ == "__main__":
    unittest.main()
