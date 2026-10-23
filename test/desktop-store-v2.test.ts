import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LegacyRead } from "../desktop/src/legacy-store.ts";
import { isSealed, keychainKey, openStore, seal, STORE_FILE, unseal, type OpenStore, type StoreKey } from "../desktop/src/store-v2.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function folder(): string {
  const d = mkdtempSync(join(tmpdir(), "kiwi-store-v2-"));
  dirs.push(d);
  return join(d, "data");
}

interface Keychain {
  key: StoreKey;
  value: () => string | null;
  sets: () => number;
}

function keychain(start: string | null = null, fail: { get?: string; set?: string } = {}): Keychain {
  let value = start;
  let sets = 0;
  return {
    key: {
      get: async () => {
        if (fail.get) throw new Error(fail.get);
        return value;
      },
      set: async (v) => {
        sets++;
        if (fail.set) throw new Error(fail.set);
        value = v;
      },
    },
    value: () => value,
    sets: () => sets,
  };
}

const NO_LEGACY = async (): Promise<LegacyRead> => ({ kind: "none" });

const STORE = { relayUrl: "https://channels.kiwiinit.com", person: { name: "Ana", pk: "pk", sk: "sk" }, channels: [] };

function opened(s: OpenStore): Extract<OpenStore, { kind: "open" }> {
  if (s.kind !== "open") throw new Error(`expected an open store, got: ${s.why}`);
  return s;
}

function put(dir: string, name: string, raw: Buffer | string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), raw);
}

const read = (dir: string, name: string = STORE_FILE): Buffer => readFileSync(join(dir, name));

const keyOf = (k: Keychain): Buffer => Buffer.from(k.value() ?? "", "base64");

describe("sealing", () => {
  const key = randomBytes(32);

  test("AES-256-GCM under a readable header, a fresh IV each time", () => {
    const a = seal('{"a":1}', key);
    const b = seal('{"a":1}', key);
    expect(a.subarray(0, 13).toString("latin1")).toBe("kiwi-store/2\n");
    expect(isSealed(a)).toBe(true);
    expect(a.equals(b)).toBe(false);
    expect(unseal(a, key)).toBe('{"a":1}');
    expect(unseal(seal("ção ✓", key), key)).toBe("ção ✓");
  });

  test("a wrong key, a flipped byte, a cut file or a changed header fails instead of returning garbage", () => {
    const raw = seal(JSON.stringify(STORE), key);
    expect(() => unseal(raw, randomBytes(32))).toThrow();
    const flipped = Buffer.from(raw);
    flipped[20] = flipped[20]! ^ 1;
    expect(() => unseal(flipped, key)).toThrow();
    expect(() => unseal(raw.subarray(0, raw.length - 1), key)).toThrow();
    expect(() => unseal(raw.subarray(0, 20), key)).toThrow();
    const header = Buffer.from(raw);
    header[0] = "K".charCodeAt(0);
    expect(() => unseal(header, key)).toThrow();
    expect(isSealed(Buffer.from('{"relayUrl":"x"}'))).toBe(false);
  });
});

describe("store v2", () => {
  test("a first run makes a 256-bit key in the keychain and saves sealed, atomically, at 0600 in a 0700 folder", async () => {
    const dir = folder();
    const k = keychain();
    const s = opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "darwin" }));
    expect(s).toMatchObject({ json: null, sealed: true, noKeychain: null, imported: null, file: join(dir, STORE_FILE) });
    expect(keyOf(k).length).toBe(32);
    s.save(JSON.stringify(STORE));
    for (const name of [STORE_FILE, `${STORE_FILE}.bak`]) {
      expect(isSealed(read(dir, name))).toBe(true);
      expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600);
    }
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir).sort()).toEqual([STORE_FILE, `${STORE_FILE}.bak`]);
    expect(read(dir).includes("Ana")).toBe(false);
    expect(opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "darwin" })).json).toEqual(STORE);
    expect(k.sets()).toBe(1);
  });

  test("Electron's store is imported once, sealed, and its file is left as it was", async () => {
    const dir = folder();
    const k = keychain();
    let asked = 0;
    const legacy = async (): Promise<LegacyRead> => {
      asked++;
      return { kind: "ok", json: STORE, file: "/old/kiwi-store.bin", encrypted: true };
    };
    const s = opened(await openStore({ dir, key: k.key, legacy, platform: "darwin" }));
    expect(s).toMatchObject({ json: STORE, sealed: true, imported: "/old/kiwi-store.bin" });
    expect(JSON.parse(unseal(read(dir), keyOf(k)))).toEqual(STORE);
    const again = opened(await openStore({ dir, key: k.key, legacy, platform: "darwin" }));
    expect(again).toMatchObject({ json: STORE, imported: null });
    expect(asked).toBe(1);
  });

  test("an Electron store that can't be read: says so and saves nothing", async () => {
    const dir = folder();
    const legacy = async (): Promise<LegacyRead> => ({ kind: "unreadable", file: "/old/kiwi-store.bin", why: "the keychain said no" });
    const s = await openStore({ dir, key: keychain().key, legacy, platform: "darwin" });
    expect(s.kind).toBe("unreadable");
    expect(s.kind === "unreadable" && s.why).toContain("/old/kiwi-store.bin");
    expect(s.kind === "unreadable" && s.why).toContain("the keychain said no");
    expect(existsSync(dir)).toBe(false);
  });

  test("a sealed store whose key is gone is unreadable, and no new key replaces it", async () => {
    const dir = folder();
    const raw = seal(JSON.stringify(STORE), randomBytes(32));
    put(dir, STORE_FILE, raw);
    const k = keychain();
    const s = await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "linux" });
    expect(s.kind).toBe("unreadable");
    expect(k.sets()).toBe(0);
    expect(read(dir).equals(raw)).toBe(true);
  });

  test("a sealed store with the wrong key, or a keychain that fails, is unreadable and left as it was", async () => {
    const dir = folder();
    const raw = seal(JSON.stringify(STORE), randomBytes(32));
    put(dir, STORE_FILE, raw);
    put(dir, `${STORE_FILE}.bak`, raw);
    const wrong = keychain(randomBytes(32).toString("base64"));
    expect((await openStore({ dir, key: wrong.key, legacy: NO_LEGACY, platform: "darwin" })).kind).toBe("unreadable");
    expect((await openStore({ dir, key: keychain(null, { get: "locked" }).key, legacy: NO_LEGACY, platform: "linux" })).kind).toBe("unreadable");
    expect(read(dir).equals(raw)).toBe(true);
    expect(read(dir, `${STORE_FILE}.bak`).equals(raw)).toBe(true);
  });

  test("a keychain value that isn't a 32-byte key is unreadable, never used", async () => {
    const dir = folder();
    put(dir, STORE_FILE, seal("{}", randomBytes(32)));
    for (const bad of ["c2hvcnQ=", "not base64 at all", randomBytes(16).toString("base64")]) {
      const s = await openStore({ dir, key: keychain(bad).key, legacy: NO_LEGACY, platform: "darwin" });
      expect(s.kind === "unreadable" && s.why).toContain("32 bytes");
    }
  });

  test("Linux without a secret service keeps plain JSON at 0600, as Electron did", async () => {
    const dir = folder();
    const k = keychain(null, { get: "no secret service", set: "no secret service" });
    const s = opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "linux" }));
    expect(s).toMatchObject({ sealed: false, noKeychain: "no secret service" });
    s.save(JSON.stringify(STORE));
    expect(JSON.parse(read(dir).toString("utf8"))).toEqual(STORE);
    expect(statSync(join(dir, STORE_FILE)).mode & 0o777).toBe(0o600);
    expect(opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "linux" })).json).toEqual(STORE);
  });

  test("a Mac without its keychain refuses, even on a first run", async () => {
    const s = await openStore({ dir: folder(), key: keychain(null, { get: "User interaction is not allowed." }).key, legacy: NO_LEGACY, platform: "darwin" });
    expect(s.kind === "unreadable" && s.why).toContain("User interaction is not allowed.");
    const set = await openStore({ dir: folder(), key: keychain(null, { set: "denied" }).key, legacy: NO_LEGACY, platform: "darwin" });
    expect(set.kind).toBe("unreadable");
  });

  test("a plain Linux store is sealed once a keychain shows up", async () => {
    const dir = folder();
    put(dir, STORE_FILE, JSON.stringify(STORE));
    const k = keychain();
    const s = opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "linux" }));
    expect(s).toMatchObject({ json: STORE, sealed: true });
    expect(isSealed(read(dir))).toBe(true);
    expect(JSON.parse(unseal(read(dir, `${STORE_FILE}.bak`), keyOf(k)))).toEqual(STORE);
  });

  test("a torn store comes back from its backup", async () => {
    const dir = folder();
    const k = keychain(randomBytes(32).toString("base64"));
    const good = seal(JSON.stringify(STORE), keyOf(k));
    put(dir, STORE_FILE, good.subarray(0, 30));
    put(dir, `${STORE_FILE}.bak`, good);
    expect(opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "darwin" })).json).toEqual(STORE);
    expect(read(dir).equals(good)).toBe(true);
  });

  test("a missing store with a damaged backup is unreadable, not a fresh start", async () => {
    const dir = folder();
    put(dir, `${STORE_FILE}.bak`, "{not json");
    let asked = 0;
    const legacy = async (): Promise<LegacyRead> => {
      asked++;
      return { kind: "none" };
    };
    const s = await openStore({ dir, key: keychain().key, legacy, platform: "linux" });
    expect(s.kind).toBe("unreadable");
    expect(asked).toBe(0);
    expect(existsSync(join(dir, STORE_FILE))).toBe(false);
  });

  test("a Mac never takes a plain copy: one planted over a sealed store is replaced from the backup, never sealed over it", async () => {
    const dir = folder();
    const k = keychain(randomBytes(32).toString("base64"));
    const good = seal(JSON.stringify(STORE), keyOf(k));
    put(dir, STORE_FILE, '{"person":{"sk":"planted"}}');
    put(dir, `${STORE_FILE}.bak`, good);
    expect(opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "darwin" })).json).toEqual(STORE);
    expect(read(dir).equals(good)).toBe(true);
    expect(read(dir, `${STORE_FILE}.bak`).equals(good)).toBe(true);
  });

  test("a Mac with only a plain copy refuses it and leaves it as it was", async () => {
    const dir = folder();
    put(dir, STORE_FILE, JSON.stringify(STORE));
    const s = await openStore({ dir, key: keychain(randomBytes(32).toString("base64")).key, legacy: NO_LEGACY, platform: "darwin" });
    expect(s.kind === "unreadable" && s.why).toContain("plain text");
    expect(read(dir).toString("utf8")).toBe(JSON.stringify(STORE));
    expect(existsSync(join(dir, `${STORE_FILE}.bak`))).toBe(false);
  });

  test("Linux, once sealed, refuses a plain copy too", async () => {
    const dir = folder();
    const k = keychain(randomBytes(32).toString("base64"));
    put(dir, STORE_FILE, '{"person":{"sk":"planted"}}');
    put(dir, `${STORE_FILE}.bak`, seal(JSON.stringify(STORE), keyOf(k)));
    expect(opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "linux" })).json).toEqual(STORE);
    expect(isSealed(read(dir))).toBe(true);
    const lone = folder();
    put(lone, `${STORE_FILE}.bak`, seal(JSON.stringify(STORE), keyOf(k)));
    put(lone, STORE_FILE, '{"person":null}');
    const noKeychain = await openStore({ dir: lone, key: keychain(null, { get: "no secret service" }).key, legacy: NO_LEGACY, platform: "linux" });
    expect(noKeychain.kind).toBe("unreadable");
  });

  test("Linux without a keychain refuses to import an encrypted Electron store in plain text, and saves nothing", async () => {
    const dir = folder();
    const legacy = async (): Promise<LegacyRead> => ({ kind: "ok", json: STORE, file: "/old/kiwi-store.bin", encrypted: true });
    const s = await openStore({ dir, key: keychain(null, { get: "no secret service", set: "no secret service" }).key, legacy, platform: "linux" });
    expect(s.kind === "unreadable" && s.why).toContain("encrypted");
    expect(s.kind === "unreadable" && s.why).toContain("no secret service");
    expect(existsSync(dir)).toBe(false);
  });

  test("Linux without a keychain imports a plain Electron store as plain, and says why", async () => {
    const dir = folder();
    const legacy = async (): Promise<LegacyRead> => ({ kind: "ok", json: STORE, file: "/old/kiwi-store.bin", encrypted: false });
    const s = opened(await openStore({ dir, key: keychain(null, { get: "no secret service", set: "no secret service" }).key, legacy, platform: "linux" }));
    expect(s).toMatchObject({ json: STORE, sealed: false, noKeychain: "no secret service", imported: "/old/kiwi-store.bin" });
    expect(JSON.parse(read(dir).toString("utf8"))).toEqual(STORE);
  });

  test("a store that isn't an object is unreadable", async () => {
    const dir = folder();
    put(dir, STORE_FILE, "[1,2]");
    expect((await openStore({ dir, key: keychain(null, { get: "none", set: "none" }).key, legacy: NO_LEGACY, platform: "linux" })).kind).toBe("unreadable");
  });
});

describe("the keychain item", () => {
  test("Bun.secrets under the service and name given", async () => {
    const get = spyOn(Bun.secrets, "get").mockResolvedValue("v");
    const set = spyOn(Bun.secrets, "set").mockResolvedValue(undefined);
    try {
      const k = keychainKey("Channels Test", "store-key-test");
      expect(await k.get()).toBe("v");
      await k.set("w");
      expect(get).toHaveBeenCalledWith({ service: "Channels Test", name: "store-key-test" });
      expect(set).toHaveBeenCalledWith({ service: "Channels Test", name: "store-key-test", value: "w" });
      await keychainKey().get();
      expect(get).toHaveBeenLastCalledWith({ service: "Channels", name: "store-key" });
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
