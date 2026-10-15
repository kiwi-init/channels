from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

USES = re.compile(r"^\s*(?:-\s+)?uses:\s*['\"]?([^'\"\s#]+)")
PINNED = re.compile(r"^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-/]+@[0-9a-f]{40}$")
DIGEST = re.compile(r"^docker://[^@\s]+@sha256:[0-9a-f]{64}$")


@dataclass(frozen=True)
class Unpinned:
    path: str
    line: int
    ref: str


def unpinned_in(text: str, path: str) -> list[Unpinned]:
    found: list[Unpinned] = []
    for number, line in enumerate(text.splitlines(), start=1):
        m = USES.match(line)
        if not m:
            continue
        ref = m.group(1)
        if ref.startswith("./") or PINNED.match(ref) or DIGEST.match(ref):
            continue
        found.append(Unpinned(path, number, ref))
    return found


def workflow_files(root: Path) -> list[Path]:
    github = root / ".github"
    files = [*github.glob("workflows/*.yml"), *github.glob("workflows/*.yaml"), *github.glob("actions/**/action.yml"), *github.glob("actions/**/action.yaml")]
    return sorted(files)


def check(root: Path) -> list[Unpinned]:
    found: list[Unpinned] = []
    for f in workflow_files(root):
        found.extend(unpinned_in(f.read_text(encoding="utf-8"), f.relative_to(root).as_posix()))
    return found


def main(argv: list[str]) -> int:
    root = Path(argv[0]) if argv else Path(".")
    found = check(root)
    annotate = os.environ.get("GITHUB_ACTIONS") == "true"
    for u in found:
        print(f"{u.path}:{u.line}: {u.ref} is not pinned to a full commit SHA (write owner/repo@<40-hex sha> # vN)")
        if annotate:
            print(f"::error file={u.path},line={u.line}::{u.ref} is not pinned to a full commit SHA")
    if found:
        print(f"{len(found)} action reference(s) not pinned to a commit.", file=sys.stderr)
        return 1
    print(f"every action in {len(workflow_files(root))} workflow and action files is pinned to a commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
