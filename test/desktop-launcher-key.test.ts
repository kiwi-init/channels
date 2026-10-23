import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { endSession, KEY_FD_ENV, keyFd, keySources, launcherChannel, launcherKey, launcherLegacyPassword, NO_READY_MARK, parseAnswer, type LineChannel } from "../desktop/src/launcher-key.ts";
import { openStore } from "../desktop/src/store-v2.ts";

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

  test("until the launcher keeps the store's ready mark (T1076), drop, finished and finish ask it nothing and fail, so a key with no store is refused, never started over", async () => {
    const s = scripted({ get: `key ${b64(Buffer.alloc(32, 7).toString("base64"))}` });
    const key = launcherKey(s.ch);
    await expect(key.finished()).rejects.toThrow(NO_READY_MARK);
    await expect(key.finish()).rejects.toThrow(NO_READY_MARK);
    await expect(key.drop()).rejects.toThrow(NO_READY_MARK);
    expect(s.asked).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), "kiwi-launcher-store-"));
    try {
      const opened = await openStore({ dir, key, legacy: async () => ({ kind: "none" }), platform: "darwin" });
      expect(opened.kind).toBe("unreadable");
      expect(opened.kind === "unreadable" ? opened.why : "").toContain(NO_READY_MARK);
      expect(readdirSync(dir)).toEqual([]);
      expect(existsSync(join(dir, "kiwi-store-v2.bin"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the old app's key is asked for by its name", async () => {
    const s = scripted({ legacy: `key ${b64("pw")}` });
    expect(await launcherLegacyPassword(s.ch)("kiwi-desktop")).toBe("pw");
    expect(s.asked).toEqual(["legacy kiwi-desktop"]);
    expect(await launcherLegacyPassword(scripted({ legacy: "none" }).ch)("Kiwi")).toBeNull();
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
