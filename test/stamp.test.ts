import { expect, test } from "bun:test";
import { section, sectionIn, upsert } from "../scripts/changelog.ts";
import { FILES, nextPatch, stampChangelog, stampText, versionOf } from "../scripts/stamp.ts";
import { VERSION } from "../src/version.ts";

test("versionOf: a release or pre-release tag, nothing else", () => {
  expect(versionOf("v0.21.0")).toBe("0.21.0");
  expect(versionOf("v0.21.0-rc.2")).toBe("0.21.0-rc.2");
  for (const bad of ["0.21.0", "v0.21", "v0.21.0 x", "release-0.21.0", "v0.21.0-", "v0.21.0-mac"]) expect(() => versionOf(bad)).toThrow();
});

test("nextPatch: the tag a rehearsal stamps", () => {
  expect(nextPatch("0.20.5")).toBe("0.20.6");
  expect(nextPatch("0.21.0-rc.3")).toBe("0.21.0");
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
  expect(app.match(/Channels-9\.8\.7-/g)?.length).toBe(4);
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
