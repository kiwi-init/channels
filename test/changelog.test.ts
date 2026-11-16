import { describe, expect, test } from "bun:test";
import {
  carryHand,
  entryOf,
  ghLookup,
  handOf,
  isBump,
  kindOf,
  line,
  namedIssues,
  rebuilt,
  release,
  section,
  sectionIn,
  upsert,
  type Commit,
  type Gh,
  type Head,
  type Lookup,
} from "../scripts/changelog.ts";

const REPO = "https://github.com/kiwi-init/channels";
const SHA = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const HEAD: Head = { tag: "v2026.11.22", sha: SHA, date: "2026-11-15" };

const look = (labels: Record<number, readonly string[] | null>, closes: Record<number, readonly number[]> = {}): Lookup & { asked: number[] } => {
  const asked: number[] = [];
  return {
    asked,
    labels: (n) => {
      asked.push(n);
      return n in labels ? (labels[n] ?? null) : [];
    },
    closes: (pr) => closes[pr] ?? [],
  };
};

const commit = (subject: string, sha = SHA): Commit => ({ sha, ...entryOf(subject) });

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

test("namedIssues: the #N in the title's closing aside, never a T-number or a # mid-title", () => {
  expect(namedIssues("Core: files and images share one blob seal (#2434, T9711)")).toEqual([2434]);
  expect(namedIssues("Home is gone: the app lands on a channel instead (#3713)")).toEqual([3713]);
  expect(namedIssues("Channel switch: a fix for #12 in the feed (T5)")).toEqual([]);
  expect(namedIssues("No aside at all")).toEqual([]);
});

describe("the kind of a change", () => {
  test("the PR's own label decides first, and several kinds take the section order", () => {
    expect(kindOf({ title: "Feed: faster (#9)", pr: 10 }, look({ 10: ["bug", "size:S"], 9: ["enhancement"] })).kind).toBe("fixes");
    expect(kindOf({ title: "x", pr: 10 }, look({ 10: ["tests", "performance", "documentation"] })).kind).toBe("performance");
    expect(kindOf({ title: "x", pr: 10 }, look({ 10: ["enhancement", "bug"] })).kind).toBe("features");
  });

  test("a PR without a kind takes the label of the issue it closes, or else of the one its title names", () => {
    expect(kindOf({ title: "x", pr: 10 }, look({ 10: ["size:M"], 7: ["documentation"] }, { 10: [7] })).kind).toBe("docs");
    expect(kindOf({ title: "Shots: two runs match (#8)", pr: 10 }, look({ 10: [], 8: ["tests"] })).kind).toBe("tests");
    expect(kindOf({ title: "Shots: two runs match (#8)", pr: 10 }, look({ 10: [], 7: ["bug"], 8: ["enhancement"] }, { 10: [7] })).kind).toBe("features");
  });

  test("no kind anywhere is Other changes, never a guess from the wording", () => {
    const got = kindOf({ title: "Fix the crash and add a docs page", pr: 10 }, look({ 10: ["size:XS"] }));
    expect(got).toEqual({ kind: "other", failed: [] });
  });

  test("one failed lookup puts the change under Other changes even when another lookup found a kind, and the warning says so", () => {
    const run = (labels: Record<number, readonly string[] | null>, closes: (pr: number) => readonly number[] | null) => {
      const told: [string, number[]][] = [];
      const lookup: Lookup = { labels: (n) => (n in labels ? (labels[n] ?? null) : []), closes };
      const sec = release("2026.11.22", HEAD, [commit("Feed: repairs (#7, #8) (#10)")], lookup, (c, failed) => told.push([c.title, failed]));
      return { sec, told };
    };
    const issueFails = run({ 10: [], 7: null, 8: ["bug"] }, () => []);
    expect(issueFails.told).toEqual([["Feed: repairs (#7, #8)", [7]]]);
    expect(issueFails.sec).toContain("### Other changes\n\n- **Feed:** repairs");
    expect(issueFails.sec).not.toContain("### Fixes");
    const closesFails = run({ 10: [], 8: ["bug"] }, () => null);
    expect(closesFails.told).toEqual([["Feed: repairs (#7, #8)", [10]]]);
    expect(closesFails.sec).toContain("### Other changes\n\n- **Feed:** repairs");
    expect(closesFails.sec).not.toContain("### Fixes");
  });

  test("a PR with its own kind needs no other lookup, so another number's failure can't touch it", () => {
    const asked: number[] = [];
    const lookup: Lookup = {
      labels: (n) => {
        asked.push(n);
        return n === 10 ? ["bug"] : null;
      },
      closes: () => null,
    };
    expect(kindOf({ title: "Feed: repairs (#7)", pr: 10 }, lookup)).toEqual({ kind: "fixes", failed: [] });
    expect(asked).toEqual([10]);
  });

  test("a lookup that fails is reported and lands under Other changes", () => {
    expect(kindOf({ title: "x (#7)", pr: 10 }, look({ 10: null, 7: ["bug"] }))).toEqual({ kind: "other", failed: [10] });
    expect(kindOf({ title: "x (#7)", pr: 10 }, look({ 10: [], 7: null }))).toEqual({ kind: "other", failed: [7] });
    const told: [string, number[]][] = [];
    const sec = release("2026.11.22", HEAD, [commit("Feed: a cold open (#10)")], look({ 10: null }), (c, failed) => told.push([c.title, failed]));
    expect(told).toEqual([["Feed: a cold open", [10]]]);
    expect(sec).toContain("### Other changes\n\n- **Feed:** a cold open");
  });
});

describe("a release's section", () => {
  const commits: Commit[] = [
    commit("Feed: a cold open shows its rows whole (#2450)", "a".repeat(40)),
    commit("kiwi 2026.11.21 (#2448)", "b".repeat(40)),
    commit("Docs: the CLI page names kiwi up (#2451)", "c".repeat(40)),
    commit("Pages that draw their own controls parse new text in one render (#2445)", "d".repeat(40)),
    commit("UI build: lazy imports stop listing the first load (#2437)", "e".repeat(40)),
  ];
  const kinds = look({ 2450: ["enhancement"], 2451: ["documentation"], 2445: ["bug"], 2437: ["performance"] });
  const sec = release("2026.11.22", HEAD, commits, kinds, () => {});

  test("kind sections in order, empty ones left out, bump commits left out", () => {
    expect(sec.match(/^### .*/gm)).toEqual(["### Features", "### Fixes", "### Performance", "### Docs"]);
    expect(sec).not.toContain("2448");
    expect(kinds.asked).not.toContain(2448);
  });

  test("the version heading, then a line with the tag, its commit linked, and the date", () => {
    expect(sec.startsWith(`## 2026.11.22 — 2026-11-15\n\nTag [v2026.11.22](${REPO}/releases/tag/v2026.11.22) · commit [1a2b3c4](${REPO}/commit/${SHA}) · 2026-11-15\n\n### Features\n`)).toBe(true);
  });

  test("each line: the area in bold, then the PR and the squash commit linked; no other bold", () => {
    expect(line(commits[0]!)).toBe(`- **Feed:** a cold open shows its rows whole ([#2450](${REPO}/pull/2450)) ([aaaaaaa](${REPO}/commit/${"a".repeat(40)}))`);
    expect(line(commits[3]!)).toBe(`- Pages that draw their own controls parse new text in one render ([#2445](${REPO}/pull/2445)) ([ddddddd](${REPO}/commit/${"d".repeat(40)}))`);
    expect(line({ title: "Drop screenshots", pr: null, sha: "f".repeat(40) })).toBe(`- Drop screenshots ([fffffff](${REPO}/commit/${"f".repeat(40)}))`);
    expect(line({ title: "Home is gone for good: the app lands on a channel", pr: 1, sha: "" })).toBe(`- Home is gone for good: the app lands on a channel ([#1](${REPO}/pull/1))`);
    expect(sec.match(/\*\*/g)?.length).toBe(2 * 3);
  });

  test("a release with nothing in it says so", () => {
    expect(section("2026.11.23", HEAD, [])).toContain("\n\n- No changes.\n");
  });
});

describe("Highlights and Upgrade", () => {
  const hand = "### Highlights\n\n- Notes now read by kind (#2497).\n\n### Upgrade\n\n- Run `kiwi up` once.\n";
  const first = section("2026.11.22", HEAD, [{ title: "Feed: a", pr: 1, sha: SHA, kind: "fixes" }]);
  const edited = first.replace("\n### Fixes", `\n${hand}\n### Fixes`);

  test("handOf takes both blocks, Highlights first, and nothing from a section without them", () => {
    expect(handOf(edited)).toBe(hand);
    expect(handOf(first)).toBe("");
    expect(handOf(null)).toBe("");
  });

  test("writing a version again keeps them above the generated sections", () => {
    const again = section("2026.11.22", { ...HEAD, date: "2026-11-16" }, [{ title: "Feed: b", pr: 2, sha: SHA, kind: "features" }]);
    const text = upsert(upsert("", "2026.11.22", edited), "2026.11.22", again);
    const kept = sectionIn(text, "v2026.11.22");
    expect(kept).toContain("— 2026-11-16");
    expect(kept).toContain("- **Feed:** b");
    expect(kept).not.toContain("- **Feed:** a");
    expect(kept!.indexOf("### Highlights")).toBeLessThan(kept!.indexOf("### Upgrade"));
    expect(kept!.indexOf("### Upgrade")).toBeLessThan(kept!.indexOf("### Features"));
    expect(kept!.indexOf("Tag [v2026.11.22]")).toBeLessThan(kept!.indexOf("### Highlights"));
    expect(carryHand(edited, section("2026.11.22", HEAD, []))).toContain(`${hand}\n- No changes.`);
  });

  test("a full rebuild keeps each release's own blocks, two releases at once, and drops versions without a tag", () => {
    const at = (tag: string, date: string): Head => ({ tag, sha: SHA, date });
    const old21 = section("2026.11.21", at("v2026.11.21", "2026-11-10"), [{ title: "Old: a", pr: 1, sha: SHA, kind: "fixes" }]).replace(
      "\n### Fixes",
      "\n### Highlights\n\n- Twenty-one.\n\n### Fixes",
    );
    const old22 = section("2026.11.22", at("v2026.11.22", "2026-11-14"), [{ title: "Old: b", pr: 2, sha: SHA, kind: "fixes" }]).replace(
      "\n### Fixes",
      "\n### Upgrade\n\n- Run `kiwi up`.\n\n### Fixes",
    );
    const current = upsert(upsert(upsert("", "2026.11.21", old21), "2026.11.22", old22), "2026.11.99", section("2026.11.99", at("v2026.11.99", "2026-11-20"), []));
    const fresh = (tag: string) => section(tag, at(tag, "2026-11-15"), [{ title: `New: ${tag.slice(1)}`, pr: 3, sha: SHA, kind: "features" }]);
    const text = rebuilt(current, ["v2026.11.21", "v2026.11.22"], fresh);
    const s21 = sectionIn(text, "2026.11.21") ?? "";
    const s22 = sectionIn(text, "2026.11.22") ?? "";
    expect(s21).toContain("### Highlights\n\n- Twenty-one.\n\n### Features\n\n- **New:** 2026.11.21");
    expect(s21).not.toContain("### Upgrade");
    expect(s22).toContain("### Upgrade\n\n- Run `kiwi up`.\n\n### Features\n\n- **New:** 2026.11.22");
    expect(s22).not.toContain("### Highlights");
    expect(sectionIn(text, "2026.11.99")).toBeNull();
    expect(text.indexOf("## 2026.11.22")).toBeLessThan(text.indexOf("## 2026.11.21"));
  });

  test("--notes shows them: the section without its heading", () => {
    const notes = (sectionIn(upsert("", "2026.11.22", edited), "v2026.11.22") ?? "").replace(/^## .*\n\n/, "");
    expect(notes.startsWith("Tag [v2026.11.22]")).toBe(true);
    expect(notes).toContain(hand);
  });
});

describe("CHANGELOG.md", () => {
  const a = section("v0.12.0", { ...HEAD, tag: "v0.12.0", date: "2026-10-20" }, [{ title: "T23: the installer puts kiwi on your PATH", pr: 103, sha: SHA, kind: "features" }]);

  test("upsert puts a new version on top and replaces the same version in place", () => {
    const old = section("0.11.0", { ...HEAD, tag: "v0.11.0", date: "2026-10-14" }, []);
    const once = upsert(upsert("", "0.11.0", old), "0.12.0", a);
    expect(once.indexOf("## 0.12.0")).toBeLessThan(once.indexOf("## 0.11.0"));
    expect(once.startsWith("# Changelog\n")).toBe(true);
    const again = upsert(once, "0.12.0", section("0.12.0", { ...HEAD, tag: "v0.12.0", date: "2026-10-22" }, []));
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

describe("the gh lookup", () => {
  const fake = (answer: (args: readonly string[]) => Gh) => {
    const calls: string[] = [];
    const lookup = ghLookup((args) => {
      calls.push(args.join(" "));
      return answer(args);
    });
    return { lookup, calls };
  };

  test("a number GitHub doesn't have has no labels and isn't a failure; any other error is", () => {
    const { lookup } = fake((args) =>
      args.includes("repos/kiwi-init/channels/issues/5411") ? { kind: "missing" } : args.includes("repos/kiwi-init/channels/issues/12") ? { kind: "ok", out: '["bug"]\n' } : { kind: "failed" },
    );
    expect(lookup.labels(5411)).toEqual([]);
    expect(lookup.labels(12)).toEqual(["bug"]);
    expect(lookup.labels(13)).toBeNull();
    expect(kindOf({ title: "Calm: the idle screen (#5411)", pr: 12 }, lookup)).toEqual({ kind: "fixes", failed: [] });
  });

  test("each number is fetched once, and a bulk warm-up answers every number after it without another call", () => {
    const { lookup, calls } = fake((args) => {
      if (args.includes("--paginate")) return { kind: "ok", out: '[1, ["bug"]]\n[2, []]\n' };
      if (args[1] === "list") return { kind: "ok", out: "[2, [1]]\n" };
      return { kind: "ok", out: '["documentation"]' };
    });
    lookup.labels(7);
    lookup.labels(7);
    expect(calls.length).toBe(1);
    lookup.warm(Array.from({ length: 60 }, (_, i) => 100 + i));
    expect(calls.length).toBe(3);
    expect(lookup.closes(2)).toEqual([1]);
    expect(lookup.labels(1)).toEqual(["bug"]);
    expect(lookup.labels(9999)).toEqual([]);
    expect(calls.length).toBe(3);
  });
});
