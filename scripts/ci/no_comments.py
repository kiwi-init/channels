from __future__ import annotations

import ast
import io
import os
import re
import subprocess
import sys
import tokenize
from dataclasses import dataclass

ALLOWED_DOCSTRINGS: frozenset[str] = frozenset()

JS_SUFFIXES = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
PY_SUFFIXES = (".py",)
CSS_SUFFIXES = (".css",)

REGEX_AFTER_WORDS = frozenset({"return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"})
REGEX_AFTER_CHARS = frozenset("(,=:[!&|?{};+-*%<>~^")
WORD = re.compile(r"[A-Za-z0-9_$\u0080-￿]+")
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    what: str


def _lines_of(src: str, start: int, end: int) -> range:
    first = src.count("\n", 0, start) + 1
    return range(first, first + src.count("\n", start, end) + 1)


def _skip_quoted(src: str, i: int, quote: str) -> int:
    j = i + 1
    while j < len(src) and src[j] != quote and src[j] != "\n":
        j += 2 if src[j] == "\\" else 1
    return j + 1


def _skip_regex(src: str, i: int) -> int:
    j = i + 1
    in_class = False
    while j < len(src) and src[j] != "\n":
        c = src[j]
        if c == "\\":
            j += 2
            continue
        if in_class:
            in_class = c != "]"
        elif c == "[":
            in_class = True
        elif c == "/":
            j += 1
            while j < len(src) and src[j].isalpha():
                j += 1
            return j
        j += 1
    return j


def _template_body(src: str, j: int) -> tuple[int, bool]:
    while j < len(src):
        c = src[j]
        if c == "\\":
            j += 2
        elif c == "`":
            return j + 1, False
        elif c == "$" and src.startswith("${", j):
            return j + 2, True
        else:
            j += 1
    return j, False


def js_comment_lines(src: str) -> set[int]:
    found: set[int] = set()
    templates: list[int] = []
    depth = 0
    last = ""
    word = ""
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c.isspace():
            i += 1
            continue
        if src.startswith("//", i) and not (i > 0 and src[i - 1] == ":"):
            end = src.find("\n", i)
            end = n if end < 0 else end
            found.update(_lines_of(src, i, end))
            i = end
            continue
        if src.startswith("/*", i):
            close = src.find("*/", i + 2)
            end = n if close < 0 else close + 2
            found.update(_lines_of(src, i, end))
            i = end
            continue
        if c in "'\"":
            i = _skip_quoted(src, i, c)
            last, word = "a", ""
            continue
        if c == "`":
            i, opened = _template_body(src, i + 1)
            if opened:
                templates.append(depth)
                depth += 1
                last, word = "{", ""
            else:
                last, word = "a", ""
            continue
        if c == "/" and not (last == "<" and src[i - 1] == "<") and (word in REGEX_AFTER_WORDS if word else (last == "" or last in REGEX_AFTER_CHARS)):
            i = _skip_regex(src, i)
            last, word = "a", ""
            continue
        m = WORD.match(src, i)
        if m:
            word = m.group(0)
            last = "a"
            i = m.end()
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if templates and templates[-1] == depth:
                templates.pop()
                i, opened = _template_body(src, i + 1)
                if opened:
                    templates.append(depth)
                    depth += 1
                    last, word = "{", ""
                else:
                    last, word = "a", ""
                continue
        last, word = c, ""
        i += 1
    return found


def css_comment_lines(src: str) -> set[int]:
    found: set[int] = set()
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        if c in "'\"":
            i = _skip_quoted(src, i, c)
        elif src.startswith("/*", i):
            close = src.find("*/", i + 2)
            end = n if close < 0 else close + 2
            found.update(_lines_of(src, i, end))
            i = end
        else:
            i += 1
    return found


def _docstrings(tree: ast.Module) -> list[tuple[str, int, int]]:
    out: list[tuple[str, int, int]] = []
    scopes = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)

    def walk(node: ast.AST, name: str) -> None:
        if isinstance(node, (ast.Module, *scopes)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                out.append((name, first.lineno, first.end_lineno or first.lineno))
        for child in ast.iter_child_nodes(node):
            if isinstance(child, scopes):
                walk(child, child.name if name == "<module>" else f"{name}.{child.name}")
            else:
                walk(child, name)

    walk(tree, "<module>")
    return out


def py_findings(src: str, path: str, allowed: frozenset[str]) -> list[Finding]:
    found: list[Finding] = []
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type == tokenize.COMMENT and not (tok.start[0] == 1 and tok.string.startswith("#!")):
            found.append(Finding(path, tok.start[0], "comment"))
    for name, first, last in _docstrings(ast.parse(src, path)):
        if f"{path}::{name}" not in allowed:
            found.extend(Finding(path, line, f"docstring of {name}") for line in range(first, last + 1))
    return found


def findings_in(src: str, path: str, allowed: frozenset[str]) -> list[Finding]:
    if path.endswith(JS_SUFFIXES):
        return [Finding(path, line, "comment") for line in sorted(js_comment_lines(src))]
    if path.endswith(CSS_SUFFIXES):
        return [Finding(path, line, "comment") for line in sorted(css_comment_lines(src))]
    if path.endswith(PY_SUFFIXES):
        return py_findings(src, path, allowed)
    return []


def _git(repo: str, *args: str) -> str:
    return subprocess.run(["git", "-C", repo, "-c", "core.quotePath=false", *args], capture_output=True, text=True, check=True).stdout


def added_lines(repo: str, base: str, head: str) -> dict[str, set[int]]:
    out: dict[str, set[int]] = {}
    path = ""
    for line in _git(repo, "diff", "--no-color", "--unified=0", "--diff-filter=AMR", "-M", base, head).splitlines():
        if line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else ""
            continue
        m = HUNK.match(line)
        if m and path:
            start = int(m.group(1))
            count = 1 if m.group(2) is None else int(m.group(2))
            out.setdefault(path, set()).update(range(start, start + count))
    return out


def check(repo: str, base: str, head: str, allowed: frozenset[str]) -> list[Finding]:
    found: list[Finding] = []
    for path, lines in sorted(added_lines(repo, base, head).items()):
        if not path.endswith(JS_SUFFIXES + CSS_SUFFIXES + PY_SUFFIXES):
            continue
        src = _git(repo, "show", f"{head}:{path}")
        found.extend(f for f in findings_in(src, path, allowed) if f.line in lines)
    return found


def main(argv: list[str]) -> int:
    base = ""
    head = "HEAD"
    rest = list(argv)
    while rest:
        flag = rest.pop(0)
        if flag in ("--base", "--head") and rest:
            value = rest.pop(0)
            if flag == "--base":
                base = value
            else:
                head = value
        else:
            print(f"usage: no_comments.py --base REV [--head REV] (got {flag})", file=sys.stderr)
            return 2
    if not base:
        print("usage: no_comments.py --base REV [--head REV]", file=sys.stderr)
        return 2
    found = check(".", base, head, ALLOWED_DOCSTRINGS)
    annotate = os.environ.get("GITHUB_ACTIONS") == "true"
    for f in found:
        print(f"{f.path}:{f.line}: {f.what} (AGENTS.md: no comments in code; context goes in the commit and the PR)")
        if annotate:
            print(f"::error file={f.path},line={f.line}::{f.what}: AGENTS.md forbids comments and tool directives in code")
    if found:
        print(f"{len(found)} added line(s) with a comment or docstring.", file=sys.stderr)
        return 1
    print(f"no comments in the lines added since {base}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
