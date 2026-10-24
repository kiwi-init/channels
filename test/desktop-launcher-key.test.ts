import { describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { randomBytes } from "node:crypto";

import { endSession, KEY_FD_ENV, keyFd, keySources, launcherChannel, launcherKey, launcherLegacyPassword, parseAnswer, type LineChannel } from "../desktop/src/launcher-key.ts";
import type { LegacyRead } from "../desktop/src/legacy-store.ts";
import { openStore, readyMark, type OpenStore } from "../desktop/src/store-v2.ts";

const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

function scripted(answers: Record<string, string>): { ch: LineChannel; asked: string[]; closed: () => boolean } {
  const asked: string[] = [];
  let closed = false;
  return {
    ch: {
      request(line) {
        asked.push(line);
        const a = answers[line] ?? answers[line.split(" ")[0] ?? ""];
        if (a === undefined) throw new Error(`no answer for ${line}`);
        return a;
      },
      close() {
        closed = true;
      },
    },
    asked,
    closed: () => closed,
  };
}

describe("the launcher's answers", () => {
  test("none, ok, a key in base64, and a failure with the launcher's words", () => {
    expect(parseAnswer("none")).toEqual({ kind: "none" });
    expect(parseAnswer("ok")).toEqual({ kind: "ok" });
    expect(parseAnswer(`key ${b64("ção ✓")}`)).toEqual({ kind: "key", value: "ção ✓" });
    expect(() => parseAnswer("fail the keychain is locked")).toThrow("the keychain is locked");
  });

  test("anything else is refused, never read as a key", () => {
    expect(() => parseAnswer("key not base64!")).toThrow("isn't base64");
    expect(() => parseAnswer(`key ${Buffer.from([0xff, 0xfe]).toString("base64")}`)).toThrow();
    expect(() => parseAnswer("KEY abc=")).toThrow("doesn't know");
    expect(() => parseAnswer("")).toThrow("doesn't know");
  });
});

describe("the store key through the launcher", () => {
  test("get: none is no key yet, a key is the keychain's value", async () => {
    expect(await launcherKey(scripted({ get: "none" }).ch).get()).toBeNull();
    expect(await launcherKey(scripted({ get: `key ${b64("c2VjcmV0")}` }).ch).get()).toBe("c2VjcmV0");
    await expect(launcherKey(scripted({ get: "ok" }).ch).get()).rejects.toThrow("should give a key");
  });

  test("set sends the value in base64 and needs ok", async () => {
    const s = scripted({ set: "ok" });
    await launcherKey(s.ch).set("a2V5");
    expect(s.asked).toEqual([`set ${b64("a2V5")}`]);
    await expect(launcherKey(scripted({ set: "fail the keychain already holds a store key" }).ch).set("x")).rejects.toThrow("already holds");
    await expect(launcherKey(scripted({ set: "none" }).ch).set("x")).rejects.toThrow("didn't save");
  });

  test("the ready mark on the wire: finished is ok or none, finish and drop need ok, and the launcher's refusals come back in its words", async () => {
    const s = scripted({ finished: "ok", finish: "ok", drop: "ok" });
    const key = launcherKey(s.ch);
    expect(await key.finished()).toBe(true);
    await key.finish("c2VhbGVk");
    await key.drop();
    expect(s.asked).toEqual(["finished", `finish ${readyMark("c2VhbGVk")}`, "drop"]);
    expect(await launcherKey(scripted({ finished: "none" }).ch).finished()).toBe(false);
    await expect(launcherKey(scripted({ finished: `key ${b64("x")}` }).ch).finished()).rejects.toThrow("should say whether");
    await expect(launcherKey(scripted({ finished: "fail the keychain is locked" }).ch).finished()).rejects.toThrow("the keychain is locked");
    await expect(launcherKey(scripted({ finish: "fail there's no store key to mark ready" }).ch).finish("eA==")).rejects.toThrow("no store key to mark ready");
    await expect(launcherKey(scripted({ finish: "none" }).ch).finish("eA==")).rejects.toThrow("didn't mark");
    await expect(launcherKey(scripted({ drop: "fail the launcher only takes back a store key it made in this session" }).ch).drop()).rejects.toThrow("made in this session");
    await expect(launcherKey(scripted({ drop: "none" }).ch).drop()).rejects.toThrow("didn't take back");
  });

  test("the old app's key is asked for by its name", async () => {
    const s = scripted({ legacy: `key ${b64("pw")}` });
    expect(await launcherLegacyPassword(s.ch)("kiwi-desktop")).toEqual(["pw"]);
    expect(s.asked).toEqual(["legacy kiwi-desktop"]);
    expect(await launcherLegacyPassword(scripted({ legacy: "none" }).ch)("Kiwi")).toEqual([]);
  });
});

interface Launcher {
  ch: LineChannel;
  items: Map<string, string>;
  asked: string[];
  start(): void;
}

function launcher(items: Record<string, string> = {}): Launcher {
  const kept = new Map(Object.entries(items));
  const asked: string[] = [];
  let made = "";
  const ch: LineChannel = {
    request(line) {
      const verb = line.split(" ")[0] ?? "";
      asked.push(verb);
      const key = kept.get("store-key");
      if (verb === "get") return key === undefined ? "none" : `key ${b64(key)}`;
      if (verb === "set") {
        if (key !== undefined) return "fail the keychain already holds a store key, and Channels never replaces one";
        const value = Buffer.from(line.slice(4), "base64").toString("utf8");
        kept.set("store-key", value);
        made = readyMark(value);
        return "ok";
      }
      if (verb === "finished") return key !== undefined && kept.get("store-key-ready") === readyMark(key) ? "ok" : "none";
      if (verb === "finish") {
        if (key === undefined) return "fail there's no store key to mark ready";
        if (line.slice(7) !== readyMark(key)) return "fail the keychain's store key isn't the one Channels sealed its store under";
        kept.set("store-key-ready", readyMark(key));
        return "ok";
      }
      if (verb === "drop") {
        if (!made) return "fail the launcher only takes back a store key it made in this session";
        if (key === undefined) return "fail the keychain no longer holds the store key this session made";
        if (readyMark(key) !== made) return "fail the keychain's store key isn't the one this session made, so the launcher leaves it";
        if (kept.get("store-key-ready") === made) return "fail the store key is marked ready, so the launcher keeps it";
        kept.delete("store-key");
        made = "";
        return "ok";
      }
      return "fail the launcher doesn't know that request";
    },
    close() {},
  };
  return {
    ch,
    items: kept,
    asked,
    start: () => {
      made = "";
      asked.length = 0;
    },
  };
}

const NO_LEGACY = async (): Promise<LegacyRead> => ({ kind: "none" });

function storeDir(): { dir: string; done: () => void } {
  const root = mkdtempSync(join(tmpdir(), "kiwi-launcher-store-"));
  return { dir: join(root, "data"), done: () => rmSync(root, { recursive: true, force: true }) };
}

async function start(l: Launcher, dir: string, legacy: () => Promise<LegacyRead> = NO_LEGACY): Promise<OpenStore> {
  l.start();
  return openStore({ dir, key: launcherKey(l.ch), legacy, platform: "darwin" });
}

describe("store v2 through the launcher, as kiwi-keys.c keeps the key and its ready mark", () => {
  test("a first run makes the key, saves, and marks it ready once the save reads back; the next start opens it", async () => {
    const { dir, done } = storeDir();
    try {
      const l = launcher();
      expect(await start(l, dir)).toMatchObject({ kind: "open", sealed: true, unmarked: null });
      const key = l.items.get("store-key") ?? "";
      expect(l.items.get("store-key-ready")).toBe(readyMark(key));
      expect(await start(l, dir)).toMatchObject({ kind: "open", json: {}, unmarked: null });
      expect(l.asked).toEqual(["get", "finished"]);
    } finally {
      done();
    }
  });

  test("a key made just before the first save failed or the app died: the next start is a first run with that key, never a lockout (#807's review)", async () => {
    const { dir, done } = storeDir();
    try {
      const made = randomBytes(32).toString("base64");
      const l = launcher({ "store-key": made });
      const legacy = async (): Promise<LegacyRead> => ({ kind: "ok", json: { relayUrl: "https://r.example" }, file: "/old/kiwi-store.bin", encrypted: true });
      expect(await start(l, dir, legacy)).toMatchObject({ kind: "open", json: { relayUrl: "https://r.example" }, imported: "/old/kiwi-store.bin", unmarked: null });
      expect([...l.items]).toEqual([
        ["store-key", made],
        ["store-key-ready", readyMark(made)],
      ]);
      expect(l.asked).not.toContain("set");
    } finally {
      done();
    }
  });

  test("a mark left by a key deleted by hand doesn't count for the key made after it, so a crash in that first run doesn't lock out", async () => {
    const { dir, done } = storeDir();
    try {
      const l = launcher({ "store-key": randomBytes(32).toString("base64"), "store-key-ready": readyMark(randomBytes(32).toString("base64")) });
      expect(await start(l, dir)).toMatchObject({ kind: "open", sealed: true, unmarked: null });
    } finally {
      done();
    }
  });

  test("a marked key whose two copies are gone is a deleted store: refused, and the launcher is asked only get and finished", async () => {
    const { dir, done } = storeDir();
    try {
      const key = randomBytes(32).toString("base64");
      const l = launcher({ "store-key": key, "store-key-ready": readyMark(key) });
      const s = await start(l, dir);
      expect(s.kind === "unreadable" && s.why).toContain("the store was deleted");
      expect(l.asked).toEqual(["get", "finished"]);
      expect(readdirSync(join(dir, ".."))).toEqual([]);
    } finally {
      done();
    }
  });

  test("a launcher that can't say whether the key is marked: refused, naming the mark, after only get and finished", async () => {
    const { dir, done } = storeDir();
    try {
      const s = scripted({ get: `key ${b64(randomBytes(32).toString("base64"))}`, finished: "fail reading the store key's ready mark: the keychain is locked" });
      const opened = await openStore({ dir, key: launcherKey(s.ch), legacy: NO_LEGACY, platform: "darwin" });
      expect(opened.kind === "unreadable" && opened.why).toContain("marked ready");
      expect(opened.kind === "unreadable" && opened.why).toContain("the keychain is locked");
      expect(s.asked).toEqual(["get", "finished"]);
    } finally {
      done();
    }
  });

  test("a first save that fails takes back the key this start made, and the next start begins again", async () => {
    const { dir, done } = storeDir();
    const root = join(dir, "..");
    try {
      mkdirSync(root, { recursive: true });
      chmodSync(root, 0o500);
      const l = launcher();
      const s = await start(l, dir);
      expect(s.kind === "unreadable" && s.why).toContain("couldn't be saved");
      expect([...l.items]).toEqual([]);
      expect(l.asked).toContain("drop");
      chmodSync(root, 0o700);
      expect(await start(l, dir)).toMatchObject({ kind: "open", sealed: true, unmarked: null });
    } finally {
      chmodSync(root, 0o700);
      done();
    }
  });

  test("a key the launcher didn't make in this start is never taken back: drop is refused and the key stays", async () => {
    const key = randomBytes(32).toString("base64");
    const l = launcher({ "store-key": key });
    l.start();
    await expect(launcherKey(l.ch).drop()).rejects.toThrow("made in this session");
    expect(l.items.get("store-key")).toBe(key);
  });

  test("a key another start already marked ready is never taken back, even by the start that made it (#808's review)", async () => {
    const l = launcher();
    l.start();
    const mine = launcherKey(l.ch);
    const made = randomBytes(32).toString("base64");
    await mine.set(made);
    l.items.set("store-key-ready", readyMark(made));
    await expect(mine.drop()).rejects.toThrow("marked ready, so the launcher keeps it");
    expect([...l.items]).toEqual([
      ["store-key", made],
      ["store-key-ready", readyMark(made)],
    ]);
  });

  test("finish marks only the key this start sealed under, never whatever the keychain holds by then (#808's review)", async () => {
    const theirs = randomBytes(32).toString("base64");
    const l = launcher({ "store-key": theirs });
    l.start();
    await expect(launcherKey(l.ch).finish(randomBytes(32).toString("base64"))).rejects.toThrow("isn't the one Channels sealed its store under");
    expect(l.items.has("store-key-ready")).toBe(false);
    await launcherKey(l.ch).finish(theirs);
    expect(l.items.get("store-key-ready")).toBe(readyMark(theirs));
  });
});

describe("where the key comes from", () => {
  test("the launcher's descriptor comes from KIWI_KEY_FD, and nothing else is taken for one", () => {
    expect(keyFd({})).toBeNull();
    expect(keyFd({ [KEY_FD_ENV]: "3" })).toBe(3);
    for (const bad of ["", "0", "1", "2", "-3", "3x", "99999", "03"]) expect(() => keyFd({ [KEY_FD_ENV]: bad })).toThrow("isn't a file descriptor");
  });

  test("taking the channel removes KIWI_KEY_FD, so nothing the app starts sees it", () => {
    const env: NodeJS.ProcessEnv = { [KEY_FD_ENV]: "bad", HOME: "/Users/ana" };
    expect(() => launcherChannel(env)).toThrow("isn't a file descriptor");
    const none: NodeJS.ProcessEnv = { HOME: "/Users/ana" };
    expect(launcherChannel(none)).toBeNull();
    expect(none).toEqual({ HOME: "/Users/ana" });
  });

  test("ending the session says done, then closes the channel, even when the launcher has gone", () => {
    const s = scripted({ done: "ok" });
    endSession(s.ch);
    expect(s.asked).toEqual(["done"]);
    expect(s.closed()).toBe(true);
    const gone = scripted({});
    expect(() => endSession(gone.ch)).toThrow();
    expect(gone.closed()).toBe(true);
  });

  test("a Mac takes the key only from the signed launcher, never from Bun.secrets", () => {
    const get = spyOn(Bun.secrets, "get");
    try {
      expect(() => keySources("darwin", {})).toThrow("signed launcher");
      expect(get).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
    }
  });

  test("Linux keeps Bun.secrets, as the Secret Service has no per-app access to give a launcher", async () => {
    const get = spyOn(Bun.secrets, "get").mockResolvedValue(null);
    try {
      const k = keySources("linux", { [KEY_FD_ENV]: "3" });
      expect(await k.key.get()).toBeNull();
      expect(get).toHaveBeenCalledWith({ service: "Channels", name: "store-key" });
      k.done();
    } finally {
      get.mockRestore();
    }
  });
});
