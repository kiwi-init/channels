import { afterEach, expect, test } from "bun:test";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { KeySources } from "../desktop/src/launcher-key.ts";
import type { LegacyName } from "../desktop/src/legacy-store.ts";
import { ebDataDir, openEbStore, plainNote, REFUSAL_ADVICE, unmarkedNote, v2Vault } from "../desktop/src/store-eb.ts";
import { isSealed, STORE_FILE, type StoreKey } from "../desktop/src/store-v2.ts";
import { brokenStore, openStore as openStoreFile } from "../desktop/src/store.ts";

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
        return password === null ? [] : [password];
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
  expect(opened).toEqual({ kind: "unreadable", why: "on a Mac, Channels gets its store key only from its signed launcher", file: join(dir, STORE_FILE), cause: "launcher" });
  expect(existsSync(dir)).toBe(false);
  const vault = v2Vault(opened);
  expect(vault.load()).toEqual({ ok: false, why: "on a Mac, Channels gets its store key only from its signed launcher", advice: REFUSAL_ADVICE.launcher });
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

test("Channels Livewire starts empty: with importLegacy off, Electron's store is never read and the launcher is never asked for its password (T839)", async () => {
  const { dir, home } = place();
  electronStore(home, { relayUrl: "https://old.example", channels: [] }, "electron-pw");
  const s = sources("electron-pw");
  const opened = await openEbStore({ dir, keys: s.keys, home, platform: "darwin", importLegacy: false });
  expect(opened).toMatchObject({ kind: "open", imported: null });
  expect(opened.kind === "open" ? opened.json?.["relayUrl"] : "not open").toBeUndefined();
  expect(s.asked).toEqual([]);
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

test("an Electron store whose key can't be found: the dialog names that file, says nothing changed, and puts unlocking before starting without it (T472)", async () => {
  const { dir, home } = place();
  const file = electronStore(home, { relayUrl: "https://old.example", channels: [] }, "electron-pw");
  const opened = await openEbStore({ dir, keys: sources(null).keys, home, platform: "darwin" });
  expect(opened).toMatchObject({ kind: "unreadable", cause: "legacy-keyless", file });
  openStoreFile(v2Vault(opened));
  const message = brokenStore()?.message ?? "";
  expect(message).toContain(`The file is ${file}.`);
  expect(message).not.toContain(STORE_FILE);
  expect(message).toContain("Nothing was changed: that file stays as it is.");
  expect(readdirSync(dirname(file))).toEqual(["kiwi-store.bin"]);
  expect(existsSync(dir)).toBe(false);
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

test("the app's data folder is pinned to its bundle identifier and build channel, not to wherever Electrobun puts userData for this install, so a dev build never opens the stable app's folder (T1710)", () => {
  expect(ebDataDir("com.kiwiinit.channels", "stable", "darwin", "/Users/a", {})).toBe("/Users/a/Library/Application Support/com.kiwiinit.channels/stable");
  expect(ebDataDir("com.kiwiinit.channels", "dev", "darwin", "/Users/a", {})).toBe("/Users/a/Library/Application Support/com.kiwiinit.channels/dev");
  expect(ebDataDir("com.kiwiinit.channels", "stable", "linux", "/home/a", {})).toBe("/home/a/.local/share/com.kiwiinit.channels/stable");
  expect(ebDataDir("com.kiwiinit.channels", "stable", "linux", "/home/a", { XDG_DATA_HOME: "/data" })).toBe("/data/com.kiwiinit.channels/stable");
  expect(ebDataDir("com.kiwiinit.channels", "stable", "linux", "/home/a", { XDG_DATA_HOME: "relative/data" })).toBe("/home/a/.local/share/com.kiwiinit.channels/stable");
  expect(ebDataDir("com.kiwiinit.channels", "stable", "win32", "C:\\Users\\a", { LOCALAPPDATA: "relative" })).toBe("C:\\Users\\a/AppData/Local/com.kiwiinit.channels/stable");
  expect(ebDataDir("com.kiwiinit.channels", "stable", "win32", "C:\\Users\\a", { LOCALAPPDATA: "/local" })).toBe("/local/com.kiwiinit.channels/stable");
  expect(() => ebDataDir("../elsewhere", "stable", "darwin", "/Users/a", {})).toThrow("plain identifier and channel");
  expect(() => ebDataDir("com.kiwiinit.channels", "../stable", "darwin", "/Users/a", {})).toThrow("plain identifier and channel");
});

test("the broken-store dialog says what to do for its cause, not 'unlock your keychain' for everything (T1710)", async () => {
  const { dir, home } = place();
  const s = sources("electron-pw");
  expect(await openEbStore({ dir, keys: s.keys, home, platform: "darwin" })).toMatchObject({ kind: "open" });
  rmSync(dir, { recursive: true, force: true });
  const deleted = await openEbStore({ dir, keys: s.keys, home, platform: "darwin" });
  expect(deleted).toMatchObject({ kind: "unreadable", cause: "deleted" });
  openStoreFile(v2Vault(deleted));
  const message = brokenStore()?.message ?? "";
  expect(message).toContain("both copies of the store are gone");
  expect(message).not.toContain("Unlock your keychain");
  openStoreFile(v2Vault(await openEbStore({ dir, keys: new Error("no launcher"), home, platform: "darwin" })));
  expect(brokenStore()?.message).toContain("Open Channels from your Applications folder");
  openStoreFile({ where: () => "/old/kiwi-store.bin", load: () => ({ ok: false, why: "the keyring is locked" }), save: () => {} });
  expect(brokenStore()?.message).toContain("Unlock your keychain, then quit and reopen Channels.");
  expect(Object.keys(REFUSAL_ADVICE).sort()).toEqual(["copy", "deleted", "keychain", "keyless", "launcher", "legacy", "legacy-keyless", "legacy-plain", "locked", "save"]);
  const keyless = REFUSAL_ADVICE["legacy-keyless"];
  expect(keyless).toStartWith("Nothing was changed: that file stays as it is.");
  expect(keyless.indexOf("unlock or start it")).toBeLessThan(keyless.indexOf("move that file out of its folder"));
  expect(keyless).toContain("Only if its key is gone for good");
  expect(REFUSAL_ADVICE["legacy-plain"]).toContain("move it out of its folder");
  expect(REFUSAL_ADVICE.copy).not.toContain("Restore the store from a backup, then");
});

test("a Linux store with no Secret Service opens in plain JSON at 0600, and the note main.log gets says so (T1550)", async () => {
  const { dir, home } = place();
  const failing: KeySources = {
    key: {
      get: async () => {
        throw new Error("Cannot autolaunch D-Bus without X11 $DISPLAY");
      },
      set: async () => {
        throw new Error("Cannot autolaunch D-Bus without X11 $DISPLAY");
      },
      drop: async () => {},
      finished: async () => false,
      finish: async () => {},
    },
    legacy: async () => [],
    done: () => {},
  };
  const opened = await openEbStore({ dir, keys: failing, home, platform: "linux" });
  expect(opened).toMatchObject({ kind: "open", sealed: false, noKeychain: "Cannot autolaunch D-Bus without X11 $DISPLAY" });
  expect(plainNote(opened)).toContain("without encryption, readable only by you (0600)");
  expect((statSync(join(dir, STORE_FILE)).mode & 0o777).toString(8)).toBe("600");
  expect(plainNote(await openEbStore({ dir: place().dir, keys: sources().keys, home, platform: "darwin" }))).toBeNull();
});
