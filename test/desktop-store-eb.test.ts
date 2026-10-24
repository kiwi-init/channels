import { afterEach, expect, test } from "bun:test";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { KeySources } from "../desktop/src/launcher-key.ts";
import type { LegacyName } from "../desktop/src/legacy-store.ts";
import { openEbStore, unmarkedNote, v2Vault } from "../desktop/src/store-eb.ts";
import { isSealed, STORE_FILE, type StoreKey } from "../desktop/src/store-v2.ts";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function place(): { dir: string; home: string } {
  const root = mkdtempSync(join(tmpdir(), "kiwi-store-eb-"));
  roots.push(root);
  return { dir: join(root, "data"), home: join(root, "home") };
}

interface Sources {
  keys: KeySources;
  asked: LegacyName[];
  done: () => number;
}

function sources(password: string | null = null, finish: string | null = null): Sources {
  let value: string | null = null;
  let mark: string | null = null;
  let done = 0;
  const asked: LegacyName[] = [];
  const key: StoreKey = {
    get: async () => value,
    set: async (v) => void (value = v),
    drop: async () => void (value = null),
    finished: async () => value !== null && mark === value,
    finish: async (k) => {
      if (finish) throw new Error(finish);
      mark = k;
    },
  };
  return {
    keys: {
      key,
      legacy: async (name) => {
        asked.push(name);
        return password;
      },
      done: () => void done++,
    },
    asked,
    done: () => done,
  };
}

function electronStore(home: string, json: unknown, password: string): string {
  const dir = join(home, "Library", "Application Support", "kiwi-desktop");
  mkdirSync(dir, { recursive: true });
  const c = createCipheriv("aes-128-cbc", pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1"), Buffer.alloc(16, 0x20));
  const file = join(dir, "kiwi-store.bin");
  writeFileSync(file, Buffer.concat([Buffer.from("v10"), c.update(JSON.stringify(json), "utf8"), c.final()]));
  return file;
}

test("a Mac app without its launcher's key channel opens no store: refused with the launcher's reason, nothing written", async () => {
  const { dir, home } = place();
  const opened = await openEbStore({ dir, keys: new Error("on a Mac, Channels gets its store key only from its signed launcher"), home, platform: "darwin" });
  expect(opened).toEqual({ kind: "unreadable", why: "on a Mac, Channels gets its store key only from its signed launcher", file: join(dir, STORE_FILE) });
  expect(existsSync(dir)).toBe(false);
  const vault = v2Vault(opened);
  expect(vault.load()).toEqual({ ok: false, why: "on a Mac, Channels gets its store key only from its signed launcher" });
  expect(() => vault.save({ relayUrl: "https://r.example", person: null, channels: [], computers: [], pending: [] })).toThrow("can't be saved");
});

test("a first start opens a sealed store, marks its key, ends the launcher's session once, and saves what the app saves through the vault", async () => {
  const { dir, home } = place();
  const s = sources();
  const opened = await openEbStore({ dir, keys: s.keys, home, platform: "darwin" });
  expect(opened).toMatchObject({ kind: "open", json: null, sealed: true, imported: null, unmarked: null });
  expect(s.done()).toBe(1);
  expect(unmarkedNote(opened)).toBeNull();
  const vault = v2Vault(opened);
  expect(vault.load()).toEqual({ ok: true, file: null, resave: false });
  vault.save({ relayUrl: "https://r.example", person: null, channels: [], computers: [], pending: [] });
  expect(isSealed(readFileSync(join(dir, STORE_FILE)))).toBe(true);
  const again = await openEbStore({ dir, keys: s.keys, home, platform: "darwin" });
  expect(again).toMatchObject({ kind: "open", json: { relayUrl: "https://r.example" }, imported: null });
  expect(s.done()).toBe(2);
});

test("Electron's store is imported once, through the launcher's password for kiwi-desktop, and the next start reads store v2 without asking again", async () => {
  const { dir, home } = place();
  const file = electronStore(home, { relayUrl: "https://old.example", channels: [] }, "electron-pw");
  const s = sources("electron-pw");
  expect(await openEbStore({ dir, keys: s.keys, home, platform: "darwin" })).toMatchObject({ kind: "open", json: { relayUrl: "https://old.example" }, imported: file });
  expect(s.asked).toEqual(["kiwi-desktop"]);
  expect(await openEbStore({ dir, keys: s.keys, home, platform: "darwin" })).toMatchObject({ kind: "open", json: { relayUrl: "https://old.example" }, imported: null });
  expect(s.asked).toEqual(["kiwi-desktop"]);
  expect(readdirSync(join(home, "Library", "Application Support", "kiwi-desktop"))).toEqual(["kiwi-store.bin"]);
});

test("a deleted store whose key is marked is refused, and Electron's store planted beside it isn't read", async () => {
  const { dir, home } = place();
  const s = sources("electron-pw");
  expect(await openEbStore({ dir, keys: s.keys, home, platform: "darwin" })).toMatchObject({ kind: "open" });
  rmSync(dir, { recursive: true, force: true });
  electronStore(home, { person: { sk: "planted" } }, "electron-pw");
  const refused = await openEbStore({ dir, keys: s.keys, home, platform: "darwin" });
  expect(refused.kind === "unreadable" && refused.why).toContain("the store was deleted");
  expect(s.asked).toEqual([]);
  expect(s.done()).toBe(2);
});

test("a keychain that won't keep the ready mark: the store opens, and the note for the person says what that costs", async () => {
  const { dir, home } = place();
  const opened = await openEbStore({ dir, keys: sources(null, "the keychain is read-only").keys, home, platform: "darwin" });
  expect(opened).toMatchObject({ kind: "open", unmarked: "the keychain is read-only" });
  expect(unmarkedNote(opened)).toContain("the keychain is read-only");
  expect(unmarkedNote(opened)).toContain("can't tell a deleted store from a first start");
});

test("a launcher that has gone before done still leaves the store open", async () => {
  const { dir, home } = place();
  const s = sources();
  const keys: KeySources = {
    ...s.keys,
    done: () => {
      throw new Error("the launcher has gone");
    },
  };
  expect(await openEbStore({ dir, keys, home, platform: "darwin" })).toMatchObject({ kind: "open", sealed: true });
});
