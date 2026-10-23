import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sealOf } from "../desktop/scripts/eb-seal.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function bundle(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "kiwi-seal-"));
  roots.push(root);
  const contents = join(root, "Channels.app", "Contents");
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(contents, rel, ".."), { recursive: true });
    writeFileSync(join(contents, rel), body);
  }
  return contents;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

test("every file bun can load is sealed by its SHA-256; Info.plist, the signature, a stapled ticket and the launcher itself are not", () => {
  const contents = bundle({
    "Info.plist": "<plist/>",
    "MacOS/kiwi-launcher": "ours",
    "MacOS/launcher": "electrobun's",
    "MacOS/bun": "bun",
    "Resources/main.js": "main",
    "Resources/app/bun/index.js": "app",
    "_CodeSignature/CodeResources": "sig",
    CodeResources: "notarization ticket",
  });
  expect(sealOf(contents, "kiwi-launcher")).toEqual({
    "MacOS/launcher": sha("electrobun's"),
    "MacOS/bun": sha("bun"),
    "Resources/main.js": sha("main"),
    "Resources/app/bun/index.js": sha("app"),
  });
});

test("a link can't be sealed, since the launcher refuses an app with one", () => {
  const contents = bundle({ "MacOS/kiwi-launcher": "ours", "Resources/main.js": "main" });
  symlinkSync("/tmp", join(contents, "Resources", "link"));
  expect(() => sealOf(contents, "kiwi-launcher")).toThrow("Resources/link isn't a plain file or folder");
});
