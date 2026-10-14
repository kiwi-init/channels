// The changelog is written from squash-merged commits: their title, PR number and the description's
// first paragraph, with version bumps, trailers and GitHub's commit-list format handled.

import { describe, expect, test } from "bun:test";
import { entryOf, isBump, section, sectionIn, upsert } from "../scripts/changelog.ts";

describe("entryOf", () => {
  test("title, PR number and the first paragraph unwrapped; trailers dropped", () => {
    const e = entryOf(
      "Release: fix the post-signing checks (codesign -dvv) (#99)",
      "0.11.0's macOS job signed and notarized both apps,\nthen failed its own check.\n\nA second paragraph.\n\nCo-authored-by: Claude Opus 5.5 <noreply@anthropic.com>\n",
    );
    expect(e).toEqual({ title: "Release: fix the post-signing checks (codesign -dvv)", pr: 99, description: "0.11.0's macOS job signed and notarized both apps, then failed its own check." });
  });

  test("a squash of several commits: the first commit's body, not its subject or the others", () => {
    const body = [
      "* Seat on first approval: a computer gets a seat (T1613)",
      "",
      "The owner's pick on #1340. A join request\nfrom an agent offers its computer.",
      "",
      "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>",
      "",
      "* Seat on first approval, from review",
      "",
      "A computer's name is the requester's to choose.",
      "",
      "---------",
      "",
      "Co-authored-by: someone <a@b.c>",
    ].join("\n");
    expect(entryOf("Seat on first approval (T1613) (#86)", body).description).toBe("The owner's pick on #1340. A join request from an agent offers its computer.");
  });

  test("a description that opens with a list stays a list", () => {
    const e = entryOf("Join without busywork (T1323) (#63)", "- kiwi join needs no --as: an agent is called\n  by what it runs in.\n- Seats: one per agent.\n\nMore.");
    expect(e.description).toBe("- kiwi join needs no --as: an agent is called\n  by what it runs in.\n- Seats: one per agent.");
  });

  test("no body, or only trailers, is no description; no (#N) is no PR", () => {
    expect(entryOf("Drop screenshots (#90)", "").description).toBe("");
    expect(entryOf("Drop screenshots (#90)", "Co-authored-by: x <x@y.z>\n").description).toBe("");
    expect(entryOf("Tests don't depend on Claude Code", "Why.").pr).toBeNull();
  });
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
    { title: "T23: the installer puts kiwi on your PATH", pr: 103, description: "One marked line in your shell's profile." },
    { title: "Drop screenshots", pr: null, description: "" },
  ]);

  test("a section: version, date, one entry per change with its PR link and description", () => {
    expect(a).toBe(
      "## 0.12.0 — 2026-10-20\n\n" +
        "- **T23: the installer puts kiwi on your PATH** ([#103](https://github.com/ojowwalker77/channels/pull/103))\n  One marked line in your shell's profile.\n" +
        "- **Drop screenshots**\n",
    );
    expect(section("0.12.1", "2026-10-21", [])).toContain("- No changes.");
  });

  test("upsert puts a new version on top and replaces the same version in place", () => {
    const old = section("0.11.0", "2026-10-14", [{ title: "Old", pr: 1, description: "" }]);
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
