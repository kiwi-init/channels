from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from action_pins import Unpinned, check, unpinned_in

SHA = "11d5960a326750d5838078e36cf38b85af677262"


class UnpinnedIn(unittest.TestCase):
    def test_tags_and_branches_are_unpinned(self) -> None:
        text = "steps:\n  - uses: actions/checkout@v4\n  - uses: oven-sh/setup-bun@main\n    with:\n      x: 1\n"
        self.assertEqual(unpinned_in(text, "ci.yml"), [Unpinned("ci.yml", 2, "actions/checkout@v4"), Unpinned("ci.yml", 3, "oven-sh/setup-bun@main")])

    def test_a_full_sha_with_a_version_note_is_pinned(self) -> None:
        text = f"      - uses: actions/checkout@{SHA} # v4\n        uses: actions/cache/save@{SHA}\n"
        self.assertEqual(unpinned_in(text, "ci.yml"), [])

    def test_a_short_sha_is_unpinned(self) -> None:
        self.assertEqual(unpinned_in("- uses: actions/checkout@11d5960\n", "a.yml"), [Unpinned("a.yml", 1, "actions/checkout@11d5960")])

    def test_local_actions_are_allowed(self) -> None:
        self.assertEqual(unpinned_in("      - uses: ./.github/actions/setup\n", "ci.yml"), [])

    def test_quoted_refs_are_read(self) -> None:
        self.assertEqual(unpinned_in("- uses: 'actions/checkout@v4'\n", "a.yml"), [Unpinned("a.yml", 1, "actions/checkout@v4")])

    def test_docker_needs_a_digest(self) -> None:
        digest = "a" * 64
        text = f"- uses: docker://alpine:3\n- uses: docker://alpine@sha256:{digest}\n"
        self.assertEqual(unpinned_in(text, "a.yml"), [Unpinned("a.yml", 1, "docker://alpine:3")])


class Check(unittest.TestCase):
    def test_reads_workflows_and_composite_actions(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            (base / ".github/workflows").mkdir(parents=True)
            (base / ".github/actions/setup").mkdir(parents=True)
            (base / ".github/workflows/ci.yml").write_text(f"- uses: actions/checkout@{SHA}\n", encoding="utf-8")
            (base / ".github/actions/setup/action.yml").write_text("- uses: oven-sh/setup-bun@v2\n", encoding="utf-8")
            self.assertEqual(check(base), [Unpinned(".github/actions/setup/action.yml", 1, "oven-sh/setup-bun@v2")])


if __name__ == "__main__":
    unittest.main()
