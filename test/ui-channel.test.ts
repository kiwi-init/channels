import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import pkg from "../desktop/package.json" with { type: "json" };
import { stageUi, uiJson } from "../desktop/scripts/ui-stage.ts";
import { PAGE_URL } from "../desktop/src/eb-page.ts";
import { UI_MANIFEST_URL, UI_PREFIX, UI_RELEASE_TAG, UI_TRUSTED_KEYS } from "../desktop/src/ui-channel.ts";
import { UI_CONTRACT, UI_DATA_SCHEMA } from "../desktop/src/ui-contract.ts";
import { latestTag } from "../desktop/src/update-asset.ts";

describe("the UI channel", () => {
  test("each pinned key is named by its keyId: the first 16 hex of the raw key's sha256", () => {
    expect(Object.keys(UI_TRUSTED_KEYS)).toEqual(["1e3ce6be9ab0ba18"]);
    for (const [keyId, publicKey] of Object.entries(UI_TRUSTED_KEYS)) {
      const raw = Buffer.from(publicKey, "base64url");
      expect(raw.length).toBe(32);
      expect(createHash("sha256").update(raw).digest("hex").slice(0, 16)).toBe(keyId);
    }
  });

  test("UIs are served where the window's page lives, from a release the app updater never takes", () => {
    expect(PAGE_URL.startsWith(`views://${UI_PREFIX}/`)).toBe(true);
    expect(UI_MANIFEST_URL).toBe(`https://github.com/kiwi-init/channels/releases/download/${UI_RELEASE_TAG}/manifest.json`);
    const repo = "kiwi-init/channels";
    expect(latestTag(repo, `https://github.com/${repo}/releases/tag/${UI_RELEASE_TAG}`)).toBeNull();
    expect(latestTag(repo, `https://github.com/${repo}/releases/tag/v2026.10.7`)).toBe("v2026.10.7");
  });

  test("a staged UI is web/dist without _headers, plus ui.json for this contract", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ui-stage-"));
    try {
      const dist = path.join(tmp, "dist");
      fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
      fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><head></head>");
      fs.writeFileSync(path.join(dist, "assets", "index-abc.js"), "x");
      fs.writeFileSync(path.join(dist, "_headers"), "/*\n  x: y");
      const out = path.join(tmp, "ui");
      const json = stageUi(dist, out, "0123456789abcdef0123456789abcdef01234567");
      expect(json).toEqual({ uiVersion: `${pkg.version}-0123456789`, requiresContract: `^${UI_CONTRACT}`, dataSchema: UI_DATA_SCHEMA });
      expect(fs.readdirSync(out).sort()).toEqual(["assets", "index.html", "ui.json"]);
      expect(JSON.parse(fs.readFileSync(path.join(out, "ui.json"), "utf8"))).toEqual(json);
      expect(() => stageUi(dist, out, "0123456")).toThrow("already exists");
      expect(() => stageUi(path.join(tmp, "none"), path.join(tmp, "ui2"), "0123456")).toThrow("index.html is missing");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("ui.json names a commit, and its uiVersion fits AppEngine's", () => {
    expect(() => uiJson("main")).toThrow("isn't a commit sha");
    expect(uiJson("abcdef1").uiVersion).toMatch(/^[A-Za-z0-9._-]{1,64}$/);
  });
});
