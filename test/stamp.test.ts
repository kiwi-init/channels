import { expect, test } from "bun:test";
import { bytesIn, section, sectionIn, sizeLine, upsert, withSize } from "../scripts/changelog.ts";
import { FILES, nextVersion, stampChangelog, stampText, versionOf } from "../scripts/stamp.ts";
import { VERSION } from "../src/version.ts";

test("versionOf: a date release or pre-release tag, vYYYY.M.PATCH, nothing else", () => {
  expect(versionOf("v2026.10.0")).toBe("2026.10.0");
  expect(versionOf("v2026.3.12")).toBe("2026.3.12");
  expect(versionOf("v2026.10.0-rc.2")).toBe("2026.10.0-rc.2");
  const bad = ["2026.10.0", "v2026.10", "v2026.10.0 x", "release-2026.10.0", "v2026.10.0-", "v2026.10.0-mac", "v2026.03.0", "v2026.13.0", "v2026.0.1", "v2026.10.01", "v0.27.8", "v1999.1.0"];
  for (const tag of bad) expect(() => versionOf(tag)).toThrow();
});

test("nextVersion: this month's next patch, or the month's first, from an old 0.x version too", () => {
  const october = new Date("2026-10-24T12:00:00Z");
  expect(nextVersion("0.27.7", october)).toBe("2026.10.0");
  expect(nextVersion("2026.10.0", october)).toBe("2026.10.1");
  expect(nextVersion("2026.10.9", october)).toBe("2026.10.10");
  expect(nextVersion("2026.9.4", october)).toBe("2026.10.0");
  expect(nextVersion("2026.12.3", new Date("2027-01-01T00:00:00Z"))).toBe("2027.1.0");
  expect(nextVersion("2026.10.1-rc.3", october)).toBe("2026.10.1");
  expect(nextVersion("0.28.0-rc.1", october)).toBe("2026.10.0");
  expect(versionOf(`v${nextVersion(VERSION, october)}`)).toBeTruthy();
});

test("every stamped file in the repo takes the tag's version, and only its version", async () => {
  for (const file of FILES) {
    const before = await Bun.file(file).text();
    const after = stampText(file, before, "9.8.7");
    expect(after).not.toContain(`Channels-${VERSION}-`);
    expect(after).not.toContain(`"${VERSION}"`);
    expect(after.replaceAll("9.8.7", VERSION)).toBe(before);
  }
  const app = stampText("site/app.js", await Bun.file("site/app.js").text(), "9.8.7");
  expect(app.match(/Channels-9\.8\.7-/g)?.length).toBe(3);
});

test("a file whose version moved out of reach fails the stamp instead of shipping stale", () => {
  expect(() => stampText("site/app.js", 'const DOWNLOADS = [{ file: "Channels-latest.dmg" }];', "1.0.0")).toThrow("site/app.js");
  expect(() => stampText("src/version.ts", "export const VERSION = `1`;", "1.0.0")).toThrow("src/version.ts");
});

test("the changelog: a release gets its section once, a hand-written one is kept, a pre-release gets none", () => {
  const head = (tag: string, date: string) => ({ tag, sha: "a".repeat(40), date });
  const made = section("0.21.0", head("v0.21.0", "2026-10-20"), [{ title: "Tag-only releases", pr: 550, sha: "b".repeat(40), kind: "features" }]);
  const once = stampChangelog(upsert("", "0.20.5", section("0.20.5", head("v0.20.5", "2026-10-19"), [])), "0.21.0", () => made);
  expect(sectionIn(once, "0.21.0")).toBe(made);
  const edited = once.replace("Tag-only releases", "Tag-only releases, by hand");
  expect(stampChangelog(edited, "0.21.0", () => made)).toBe(edited);
  expect(stampChangelog(once, "0.22.0-rc.1", () => made)).toBe(once);
});

test("a stamped release says its first-load bytes and the change since the release below it (#2499)", () => {
  const head = (tag: string, date: string) => ({ tag, sha: "a".repeat(40), date });
  const made = section("0.22.0", head("v0.22.0", "2026-10-21"), [{ title: "Smaller first load", pr: 560, sha: "c".repeat(40), kind: "performance" }]);
  const measured = upsert("", "0.21.0", withSize(section("0.21.0", head("v0.21.0", "2026-10-20"), []), sizeLine(800_000, null)));
  const stamped =
    sectionIn(
      stampChangelog(
        measured,
        "0.22.0",
        () => made,
        () => 799_837,
      ),
      "0.22.0",
    ) ?? "";
  expect(stamped.split("\n").slice(0, 5)).toEqual([
    "## 0.22.0 — 2026-10-21",
    "",
    `Tag [v0.22.0](https://github.com/kiwi-init/channels/releases/tag/v0.22.0) · commit [aaaaaaa](https://github.com/kiwi-init/channels/commit/${"a".repeat(40)}) · 2026-10-21`,
    "",
    "First-load JS: 799,837 bytes (-163 since 0.21.0)",
  ]);
  expect(bytesIn(stamped)).toBe(799_837);

  const unmeasured = upsert("", "0.21.0", section("0.21.0", head("v0.21.0", "2026-10-20"), []));
  expect(
    sectionIn(
      stampChangelog(
        unmeasured,
        "0.22.0",
        () => made,
        () => 799_837,
      ),
      "0.22.0",
    ),
  ).toContain("First-load JS: 799,837 bytes (change since 0.21.0 unavailable: it has no first-load figure)");
  expect(
    sectionIn(
      stampChangelog(
        "",
        "0.22.0",
        () => made,
        () => 799_837,
      ),
      "0.22.0",
    ),
  ).toContain("First-load JS: 799,837 bytes (no earlier release to compare)");
});

test("the first-load change reads as more, less or none, and a pre-release or a stamped one isn't measured", () => {
  expect(sizeLine(801_200, { version: "v0.21.0", bytes: 800_000 })).toBe("First-load JS: 801,200 bytes (+1,200 since 0.21.0)");
  expect(sizeLine(800_000, { version: "0.21.0", bytes: 800_000 })).toBe("First-load JS: 800,000 bytes (no change since 0.21.0)");
  expect(sizeLine(0, { version: "0.21.0", bytes: null })).not.toContain("+0");
  const never = () => {
    throw new Error("measured");
  };
  const made = section("0.22.0", { tag: "v0.22.0", sha: "a".repeat(40), date: "2026-10-21" }, []);
  expect(stampChangelog("", "0.22.0-rc.1", () => made, never)).toBe("");
  const once = stampChangelog(
    "",
    "0.22.0",
    () => made,
    () => 1,
  );
  expect(stampChangelog(once, "0.22.0", () => made, never)).toBe(once);
});

test("rewriting a release's section keeps its first-load line", () => {
  const head = { tag: "v0.22.0", sha: "a".repeat(40), date: "2026-10-21" };
  const old = withSize(section("0.22.0", head, []), "First-load JS: 799,837 bytes (-163 since 0.21.0)");
  const fresh = section("0.22.0", head, [{ title: "A late title fix", pr: 561, sha: "d".repeat(40), kind: "fixes" }]);
  const again = sectionIn(upsert(upsert("", "0.22.0", old), "0.22.0", fresh), "0.22.0") ?? "";
  expect(again).toContain("First-load JS: 799,837 bytes (-163 since 0.21.0)");
  expect(again).toContain("A late title fix");
  expect(withSize(old, "First-load JS: 1 bytes (no earlier release to compare)").match(/First-load JS/g)).toHaveLength(1);
});
