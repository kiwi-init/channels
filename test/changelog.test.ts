// The changelog is written from squash-merged commits: their title and PR number, with version bumps left out.

import { describe, expect, test } from "bun:test";
import { entryOf, isBump, section, sectionIn, upsert } from "../scripts/changelog.ts";

test("entryOf: the title and the PR number GitHub appends; no (#N) is no PR", () => {
  expect(entryOf("Release: fix the post-signing checks (codesign -dvv) (#99)")).toEqual({ title: "Release: fix the post-signing checks (codesign -dvv)", pr: 99 });
  expect(entryOf("Tests don't depend on Claude Code")).toEqual({ title: "Tests don't depend on Claude Code", pr: null });
});

test("isBump: version-bump commits only", () => {
  expect(isBump("kiwi 0.11.0 (#98)")).toBe(true);
  expect(isBump("kiwi 0.10.0")).toBe(true);
  expect(isBump("kiwi 0.11.0-rc.8")).toBe(true);
  expect(isBump("kiwi 0.10.2: the e2e test passes where kiwi isn't installed (#83)")).toBe(false);
  expect(isBump("Release: sign the Mac app; 0.11.0-rc.8 (#97)")).toBe(false);
});

describe("CHANGELOG.md", () => {
  const a = section("v0.12.0", "2026-10-20", [
    { title: "T23: the installer puts kiwi on your PATH", pr: 103 },
    { title: "Drop screenshots", pr: null },
  ]);

  test("a section: version, date, one entry per change with its PR link", () => {
    expect(a).toBe(
      "## 0.12.0 — 2026-10-20\n\n" +
        "- **T23: the installer puts kiwi on your PATH** ([#103](https://github.com/ojowwalker77/channels/pull/103))\n" +
        "- **Drop screenshots**\n",
    );
    expect(section("0.12.1", "2026-10-21", [])).toContain("- No changes.");
  });

  test("upsert puts a new version on top and replaces the same version in place", () => {
    const old = section("0.11.0", "2026-10-14", [{ title: "Old", pr: 1 }]);
    const once = upsert(upsert("", "0.11.0", old), "0.12.0", a);
    expect(once.indexOf("## 0.12.0")).toBeLessThan(once.indexOf("## 0.11.0"));
    expect(once.startsWith("# Changelog\n")).toBe(true);
    const again = upsert(once, "0.12.0", section("0.12.0", "2026-10-22", []));
    expect(again.match(/^## 0\.12\.0/gm)?.length).toBe(1);
    expect(again).toContain("## 0.12.0 — 2026-10-22");
    expect(again).toContain("## 0.11.0 — 2026-10-14");
  });

  test("sectionIn finds a version's section and nothing for one it doesn't have", () => {
    const text = upsert("", "0.12.0", a);
    expect(sectionIn(text, "v0.12.0")).toBe(a);
    expect(sectionIn(text, "v0.12.1")).toBeNull();
    expect(sectionIn(text, "v0.1")).toBeNull();
  });
});
