import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import pkg from "../desktop/package.json" with { type: "json" };
import { stageUi, uiJson } from "../desktop/scripts/ui-stage.ts";
import { PAGE_URL } from "../desktop/src/eb-page.ts";
import { UI_MANIFEST_URL, UI_PREFIX, UI_RELEASE_TAG, UI_TRUSTED_KEYS } from "../desktop/src/ui-channel.ts";
import { UI_DATA_SCHEMA, UI_REQUIRES } from "../desktop/src/ui-contract.ts";
import { olderLook, ownLookSeq } from "../desktop/src/ui-older.ts";
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

  test("a staged UI is ui/dist without _headers, plus ui.json for this contract", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ui-stage-"));
    try {
      const dist = path.join(tmp, "dist");
      fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
      fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><head></head>");
      fs.writeFileSync(path.join(dist, "assets", "index-abc.js"), "x");
      fs.writeFileSync(path.join(dist, "_headers"), "/*\n  x: y");
      const out = path.join(tmp, "ui");
      const json = stageUi(dist, out, "0123456789abcdef0123456789abcdef01234567");
      expect(json).toEqual({ uiVersion: `${pkg.version}-0123456789`, requiresContract: `^${UI_REQUIRES}`, dataSchema: UI_DATA_SCHEMA });
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

describe("a build keeps its own look over one made for an older contract (T8622)", () => {
  const look = (seq: number, requiresContract: string) => ({ format: "livewire-manifest/1", seq, uiVersion: `look-${seq}`, requiresContract, sha256: "0".repeat(64) });

  test("a published look made for an older contract is refused before it's downloaded, so it's never offered", () => {
    expect(olderLook(look(1, "^3.13.0"), "3.16.0")).toBe("UI look-1 is made for contract ^3.13.0, older than this build's own UI (3.16.0)");
    expect(olderLook(look(1, ">=3.15.9 <4.0.0"), "3.16.0")).not.toBeNull();
    expect(olderLook(look(1, "*"), "3.16.0")).not.toBeNull();
  });

  test("a look made for this build's contract or a newer one still applies", () => {
    expect(olderLook(look(1, "^3.16.0"), "3.16.0")).toBeNull();
    expect(olderLook(look(1, "^3.17.2"), "3.16.0")).toBeNull();
    expect(olderLook(look(1, ">=4.0.0"), "3.16.0")).toBeNull();
    expect(olderLook(uiJson("abcdef1"))).toBeNull();
  });

  test("at start, an installed look made for an older contract no longer counts as newer than the built-in one", () => {
    const state = { current: look(500, "^3.13.0"), next: look(700, "^3.14.0"), good: [look(400, "^3.13.0"), "junk"], retry: null };
    expect(ownLookSeq(state, 100, "3.16.0")).toBe(700);
    expect(ownLookSeq({ ...state, next: look(700, "^3.16.0") }, 100, "3.16.0")).toBe(500);
  });

  test("at start, newer-contract looks and a missing or broken state leave the built-in seq alone", () => {
    expect(ownLookSeq({ current: look(500, "^3.16.0"), good: [look(400, "^3.17.0")] }, 100, "3.16.0")).toBe(100);
    expect(ownLookSeq({ current: look(50, "^3.13.0") }, 100, "3.16.0")).toBe(100);
    for (const broken of [null, "x", [], { current: { seq: "9", uiVersion: "x", requiresContract: "^1.0.0" } }]) expect(ownLookSeq(broken, 100, "3.16.0")).toBe(100);
  });
});
