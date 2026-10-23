import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { legacyPassword } from "../desktop/src/legacy-keys.ts";
import { readLegacyStore, type LegacyRead } from "../desktop/src/legacy-store.ts";
import { isSealed, keychainKey, openStore, readyMark, seal, STORE_FILE, unseal, type OpenStore, type StoreKey } from "../desktop/src/store-v2.ts";

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
  ready: () => boolean;
}

function keychain(start: string | null = null, fail: { get?: string; set?: string; finished?: string; finish?: string } = {}, done = false): Keychain {
  let value = start;
  let sets = 0;
  let ready = done;
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
      drop: async () => {
        value = null;
        ready = false;
      },
      finished: async () => {
        if (fail.finished) throw new Error(fail.finished);
        return ready;
      },
      finish: async () => {
        if (fail.finish) throw new Error(fail.finish);
        ready = true;
      },
    },
    value: () => value,
    sets: () => sets,
    ready: () => ready,
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
    const k = keychain();
    const s = await openStore({ dir, key: k.key, legacy, platform: "darwin" });
    expect(s.kind).toBe("unreadable");
    expect(s.kind === "unreadable" && s.why).toContain("/old/kiwi-store.bin");
    expect(s.kind === "unreadable" && s.why).toContain("the keychain said no");
    expect(existsSync(dir)).toBe(false);
    expect(k.sets()).toBe(0);
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
    const k = keychain();
    const s = await openStore({ dir, key: k.key, legacy, platform: "linux" });
    expect(s.kind).toBe("unreadable");
    expect(asked).toBe(0);
    expect(existsSync(join(dir, STORE_FILE))).toBe(false);
    expect(k.sets()).toBe(0);
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

  test("a Mac never imports a plain Electron store, so planting one gets nothing in, and no key is made for it", async () => {
    for (const name of ["kiwi-desktop", "Kiwi"]) {
      const dir = folder();
      const home = join(dir, "..", "home");
      const k = keychain();
      put(join(home, "Library", "Application Support", name), "kiwi-store.bin", '{"person":{"sk":"planted"}}');
      const legacy = () => readLegacyStore(legacyPassword("darwin"), "darwin", home, {});
      const s = await openStore({ dir, key: k.key, legacy, platform: "darwin" });
      expect(s.kind === "unreadable" && s.why).toContain("plain text");
      expect(existsSync(dir)).toBe(false);
      expect(k.sets()).toBe(0);
    }
  });

  test("a Mac whose keychain still holds the store key but whose two copies are gone refuses it as a deleted store, and imports nothing", async () => {
    const dir = folder();
    const k = keychain();
    opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "darwin" })).save('{"person":{"sk":"real-sk"}}');
    rmSync(join(dir, STORE_FILE));
    rmSync(join(dir, `${STORE_FILE}.bak`));
    let asked = 0;
    const encryptedByTheOldApp = async (): Promise<LegacyRead> => {
      asked++;
      return { kind: "ok", json: { person: { sk: "planted" } }, file: "/old/kiwi-store.bin", encrypted: true };
    };
    const s = await openStore({ dir, key: k.key, legacy: encryptedByTheOldApp, platform: "darwin" });
    expect(s.kind === "unreadable" && s.why).toContain("deleted");
    expect(asked).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
    expect(k.sets()).toBe(1);
  });

  test("a first run marks its key finished only once the first save reads back", async () => {
    const dir = folder();
    const k = keychain();
    opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "darwin" }));
    expect(k.ready()).toBe(true);
  });

  test("a first run cut off right after the key was made: the next start carries on with that key and imports", async () => {
    const dir = folder();
    const made = randomBytes(32).toString("base64");
    const k = keychain(made);
    const legacy = async (): Promise<LegacyRead> => ({ kind: "ok", json: STORE, file: "/old/kiwi-store.bin", encrypted: true });
    const s = opened(await openStore({ dir, key: k.key, legacy, platform: "darwin" }));
    expect(s).toMatchObject({ json: STORE, imported: "/old/kiwi-store.bin", sealed: true });
    expect({ sets: k.sets(), value: k.value(), ready: k.ready() }).toEqual({ sets: 0, value: made, ready: true });
    expect(JSON.parse(unseal(read(dir), keyOf(k)))).toEqual(STORE);
  });

  test("a first save that fails takes its new key back, and the next start imports", async () => {
    const root = folder();
    mkdirSync(root, { mode: 0o500 });
    const dir = join(root, "store");
    const k = keychain();
    const legacy = async (): Promise<LegacyRead> => ({ kind: "ok", json: STORE, file: "/old/kiwi-store.bin", encrypted: true });
    const s = await openStore({ dir, key: k.key, legacy, platform: "darwin" });
    expect(s.kind === "unreadable" && s.why).toContain("couldn't be saved");
    expect({ value: k.value(), ready: k.ready() }).toEqual({ value: null, ready: false });
    chmodSync(root, 0o700);
    expect(opened(await openStore({ dir, key: k.key, legacy, platform: "darwin" }))).toMatchObject({ json: STORE, imported: "/old/kiwi-store.bin" });
    expect(k.ready()).toBe(true);
  });

  test("a start cut off after the first save but before the mark opens the copies and sets the mark", async () => {
    const dir = folder();
    const k = keychain(randomBytes(32).toString("base64"));
    put(dir, STORE_FILE, seal(JSON.stringify(STORE), keyOf(k)));
    put(dir, `${STORE_FILE}.bak`, seal(JSON.stringify(STORE), keyOf(k)));
    expect(opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "darwin" })).json).toEqual(STORE);
    expect(k.ready()).toBe(true);
  });

  test("a keychain that can't say whether the key is finished is refused when both copies are gone", async () => {
    const dir = folder();
    const s = await openStore({ dir, key: keychain(randomBytes(32).toString("base64"), { finished: "locked" }).key, legacy: NO_LEGACY, platform: "darwin" });
    expect(s.kind === "unreadable" && s.why).toContain("marked ready");
    expect(s.kind === "unreadable" && s.why).toContain("locked");
    expect(existsSync(dir)).toBe(false);
  });

  test("Linux sealing a plain store reads its new key back first, and stays plain when the keychain doesn't keep it", async () => {
    const dir = folder();
    put(dir, STORE_FILE, JSON.stringify(STORE));
    let sets = 0;
    let drops = 0;
    const leaky: StoreKey = { get: async () => null, set: async () => void sets++, drop: async () => void drops++, finished: async () => false, finish: async () => {} };
    const s = opened(await openStore({ dir, key: leaky, legacy: NO_LEGACY, platform: "linux" }));
    expect(s).toMatchObject({ json: STORE, sealed: false, noKeychain: "it didn't keep the store key Channels just made" });
    expect({ sets, drops }).toEqual({ sets: 1, drops: 0 });
    expect(isSealed(read(dir))).toBe(false);
  });

  test("a first run saves an empty sealed store at once, so a quick quit isn't taken for a deleted store next time", async () => {
    const dir = folder();
    const k = keychain();
    expect(opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "darwin" })).json).toBeNull();
    expect(isSealed(read(dir))).toBe(true);
    expect(opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "darwin" })).json).toEqual({});
    expect(k.sets()).toBe(1);
  });

  test("a keychain that doesn't keep the key Channels made is refused before anything is saved", async () => {
    const dir = folder();
    let sets = 0;
    const leaky: StoreKey = { get: async () => null, set: async () => void sets++, drop: async () => {}, finished: async () => false, finish: async () => {} };
    const s = await openStore({ dir, key: leaky, legacy: NO_LEGACY, platform: "darwin" });
    expect(s.kind === "unreadable" && s.why).toContain("didn't keep the store key");
    expect(sets).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });

  test("a key read back that isn't the one Channels just made (another start got there first) is refused, and nothing is taken back or removed", async () => {
    const dir = folder();
    const theirs = randomBytes(32).toString("base64");
    put(dir, "theirs.txt", "left as it was");
    let value: string | null = null;
    let drops = 0;
    const raced: StoreKey = {
      get: async () => value,
      set: async () => void (value = theirs),
      drop: async () => void drops++,
      finished: async () => false,
      finish: async () => {},
    };
    const s = await openStore({ dir, key: raced, legacy: NO_LEGACY, platform: "darwin" });
    expect(s.kind === "unreadable" && s.why).toContain("didn't keep the store key");
    expect({ value: await raced.get(), drops, files: readdirSync(dir) }).toEqual({ value: theirs, drops: 0, files: ["theirs.txt"] });
  });

  test("a keychain that won't take the ready mark: the store opens, and says why its key isn't marked", async () => {
    const dir = folder();
    const k = keychain(null, { finish: "the keychain is read-only" });
    expect(opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "darwin" }))).toMatchObject({ sealed: true, unmarked: "the keychain is read-only" });
    expect(opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "darwin" }))).toMatchObject({ json: {}, unmarked: "the keychain is read-only" });
    expect(opened(await openStore({ dir, key: keychain(k.value()).key, legacy: NO_LEGACY, platform: "darwin" }))).toMatchObject({ json: {}, unmarked: null });
  });

  test("Linux, where the Secret Service gives no app its own key, starts over when both copies are gone", async () => {
    const dir = folder();
    const k = keychain(randomBytes(32).toString("base64"));
    const s = opened(await openStore({ dir, key: k.key, legacy: NO_LEGACY, platform: "linux" }));
    expect(s).toMatchObject({ json: null, sealed: true });
    expect(k.sets()).toBe(0);
  });

  test("Linux with no keychain imports a v10 Electron store (Chromium's fixed password) as plain", async () => {
    const dir = folder();
    const home = join(dir, "..", "home");
    const key = pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1");
    const c = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
    put(join(home, ".config", "kiwi-desktop"), "kiwi-store.bin", Buffer.concat([Buffer.from("v10"), c.update(JSON.stringify(STORE), "utf8"), c.final()]));
    const legacy = () => readLegacyStore(legacyPassword("linux"), "linux", home, {});
    const s = opened(await openStore({ dir, key: keychain(null, { get: "no secret service", set: "no secret service" }).key, legacy, platform: "linux" }));
    expect(s).toMatchObject({ json: STORE, sealed: false, noKeychain: "no secret service" });
    expect(JSON.parse(read(dir).toString("utf8"))).toEqual(STORE);
  });

  test("each refusal names its cause, so the app can say what to do about it (T1710)", async () => {
    const cause = (o: OpenStore): string => (o.kind === "unreadable" ? o.cause : "open");
    const sealedDir = folder();
    const k = keychain();
    opened(await openStore({ dir: sealedDir, key: k.key, legacy: NO_LEGACY, platform: "darwin" })).save("{}");
    expect(cause(await openStore({ dir: sealedDir, key: keychain().key, legacy: NO_LEGACY, platform: "darwin" }))).toBe("keyless");
    expect(cause(await openStore({ dir: sealedDir, key: keychain(null, { get: "locked" }).key, legacy: NO_LEGACY, platform: "darwin" }))).toBe("keychain");
    rmSync(join(sealedDir, STORE_FILE));
    rmSync(join(sealedDir, `${STORE_FILE}.bak`));
    expect(cause(await openStore({ dir: sealedDir, key: k.key, legacy: NO_LEGACY, platform: "darwin" }))).toBe("deleted");
    const plainOld = async (): Promise<LegacyRead> => ({ kind: "ok", json: STORE, file: "/old/kiwi-store.bin", encrypted: false });
    expect(cause(await openStore({ dir: folder(), key: keychain().key, legacy: plainOld, platform: "darwin" }))).toBe("legacy-plain");
    const unreadableOld = async (): Promise<LegacyRead> => ({ kind: "unreadable", file: "/old/kiwi-store.bin", why: "locked" });
    expect(cause(await openStore({ dir: folder(), key: keychain().key, legacy: unreadableOld, platform: "darwin" }))).toBe("legacy");
    const torn = folder();
    put(torn, STORE_FILE, "not json");
    expect(cause(await openStore({ dir: torn, key: keychain(null, { get: "none", set: "none" }).key, legacy: NO_LEGACY, platform: "linux" }))).toBe("copy");
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

  function secrets(): { items: Map<string, string>; restore: () => void } {
    const items = new Map<string, string>();
    const at = (o: { service: string; name: string }): string => `${o.service}/${o.name}`;
    const get = spyOn(Bun.secrets, "get").mockImplementation(async (o) => items.get(at(o)) ?? null);
    const set = spyOn(Bun.secrets, "set").mockImplementation(async (o) => void items.set(at(o), o.value));
    const del = spyOn(Bun.secrets, "delete").mockImplementation(async (o) => items.delete(at(o)));
    return {
      items,
      restore: () => {
        get.mockRestore();
        set.mockRestore();
        del.mockRestore();
      },
    };
  }

  test("the ready mark is a second item holding the SHA-256 of the key it marks, so a mark left by another key doesn't count", async () => {
    const s = secrets();
    try {
      const k = keychainKey("Channels Test", "store-key-test");
      expect(await k.finished()).toBe(false);
      await expect(k.finish("a2V5")).rejects.toThrow("no store key to mark ready");
      await k.set("a2V5");
      expect(await k.finished()).toBe(false);
      await expect(k.finish("b3RoZXI=")).rejects.toThrow("isn't the one Channels sealed its store under");
      await k.finish("a2V5");
      expect(s.items.get("Channels Test/store-key-test-ready")).toBe(readyMark("a2V5"));
      expect(readyMark("a2V5")).toMatch(/^[0-9a-f]{64}$/);
      expect(await k.finished()).toBe(true);
      s.items.set("Channels Test/store-key-test", "b3RoZXI=");
      expect(await k.finished()).toBe(false);
    } finally {
      s.restore();
    }
  });

  test("drop takes back only a key this run made, while the keychain still holds it and nothing has marked it ready", async () => {
    const s = secrets();
    try {
      s.items.set("Channels Test/store-key-test", "b2xk");
      await expect(keychainKey("Channels Test", "store-key-test").drop()).rejects.toThrow("only a store key it made in this run");
      expect(s.items.get("Channels Test/store-key-test")).toBe("b2xk");
      s.items.clear();
      const mine = keychainKey("Channels Test", "store-key-test");
      await mine.set("bmV3");
      await mine.drop();
      expect([...s.items.keys()]).toEqual([]);
      await expect(mine.drop()).rejects.toThrow("only a store key it made in this run");
      const marked = keychainKey("Channels Test", "store-key-test");
      await marked.set("bWFya2Vk");
      await keychainKey("Channels Test", "store-key-test").finish("bWFya2Vk");
      await expect(marked.drop()).rejects.toThrow("marked ready, so Channels keeps it");
      expect(s.items.get("Channels Test/store-key-test")).toBe("bWFya2Vk");
      s.items.clear();
      const raced = keychainKey("Channels Test", "store-key-test");
      await raced.set("bWluZQ==");
      s.items.set("Channels Test/store-key-test", "dGhlaXJz");
      await expect(raced.drop()).rejects.toThrow("while the keychain still holds it");
      expect(s.items.get("Channels Test/store-key-test")).toBe("dGhlaXJz");
    } finally {
      s.restore();
    }
  });
});
