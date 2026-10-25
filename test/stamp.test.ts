import { expect, test } from "bun:test";
import { section, sectionIn, upsert } from "../scripts/changelog.ts";
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
  const made = section("0.21.0", "2026-10-20", [{ title: "Tag-only releases", pr: 550 }]);
  const once = stampChangelog(upsert("", "0.20.5", section("0.20.5", "2026-10-19", [])), "0.21.0", () => made);
  expect(sectionIn(once, "0.21.0")).toBe(made);
  const edited = once.replace("Tag-only releases", "Tag-only releases, by hand");
  expect(stampChangelog(edited, "0.21.0", () => made)).toBe(edited);
  expect(stampChangelog(once, "0.22.0-rc.1", () => made)).toBe(once);
});
