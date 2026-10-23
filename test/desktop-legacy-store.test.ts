import { afterEach, describe, expect, test } from "bun:test";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { legacyPassword } from "../desktop/src/legacy-keys.ts";
import { legacyDirs, legacyPrefix, legacyRounds, openLegacy, readLegacyAt, readLegacyStore, type LegacyName } from "../desktop/src/legacy-store.ts";

const ELECTRON_LINUX = {
  keyring: "gk2sW4WabwOsnX/FPdTgOw==",
  vectors: [
    {
      plain: '{"relayUrl":"https://channels.kiwiinit.com","person":{"name":"Ana","pk":"pk","sk":"sk"}}',
      b64: "djExfzEdBihniNSHGn40wWj+eLU2/GoIxM/mIb6cd9l+wnmyRIDBxNGCC3uCYEFov+6+gqGDdm2JtVg5rkEIGdmNRGARNCeJHbBV3amjKV1mLoR5rL5Kg6DoPl1dE4Xmgdc1",
    },
    { plain: "xxxxxxxxxxxxxxxx", b64: "djExOC714415uFqY9hxSaOgqsHSx2b41e8iOg6ILb6c2XC0=" },
    { plain: "ção ✓", b64: "djExAoiRD+eqALOOnTfTckl9PQ==" },
  ],
};

const ELECTRON_MAC = {
  keychain: "qLaRYblVbtE1o7PEPkZRaA==",
  vectors: [
    {
      plain: '{"relayUrl":"https://channels.kiwiinit.com","person":{"name":"Ana","pk":"pk","sk":"sk"}}',
      b64: "djEwf7CSXdXk4p86xi7g1dnPPTUa/E7nYq8Op4ciHZ2IAPxPV+LSX73/9k7OM++5yqbSS0Qe9qzX7HvnStoKoNXe0lphVYgR4mQhx0rPKCj6ap/h+gjGAifhTH71WoeZ0o1O",
    },
    { plain: "xxxxxxxxxxxxxxxx", b64: "djEwVeG09SG9Qdnm4t987pvF+NafatOnkbT0dBaNJopFJjM=" },
    { plain: "ção ✓", b64: "djEwzlzsfKMQ0LGefx0W+lx5sg==" },
  ],
};

function chromium(prefix: "v10" | "v11", plain: string, password: string, rounds: number): Buffer {
  const key = pbkdf2Sync(password, "saltysalt", rounds, 16, "sha1");
  const c = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from(prefix), c.update(plain, "utf8"), c.final()]);
}

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

function home(): string {
  const h = mkdtempSync(join(tmpdir(), "kiwi-legacy-"));
  homes.push(h);
  return h;
}

function put(dir: string, raw: Buffer | string, name: string = "kiwi-store.bin"): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, raw);
  return file;
}

const keychain =
  (entries: Partial<Record<LegacyName, string>>) =>
  async (name: LegacyName): Promise<string | null> =>
    entries[name] ?? null;

const linuxStore = (): Buffer => Buffer.from(ELECTRON_LINUX.vectors[0]!.b64, "base64");

describe("Electron safeStorage ciphertext", () => {
  test("opens what Electron 44.7.2 wrote with a GNOME keyring (v11)", async () => {
    for (const v of ELECTRON_LINUX.vectors) {
      const raw = Buffer.from(v.b64, "base64");
      expect(legacyPrefix(raw)).toBe("v11");
      expect(await openLegacy(raw, ELECTRON_LINUX.keyring, legacyRounds("linux"))).toBe(v.plain);
    }
  });

  test("opens what Electron 44.9.0 wrote with the macOS Keychain (v10, 1003 rounds)", async () => {
    expect(ELECTRON_MAC.vectors.length).toBe(3);
    for (const v of ELECTRON_MAC.vectors) {
      const raw = Buffer.from(v.b64, "base64");
      expect(legacyPrefix(raw)).toBe("v10");
      expect(await openLegacy(raw, ELECTRON_MAC.keychain, legacyRounds("darwin"))).toBe(v.plain);
    }
  });

  test("a wrong key fails instead of returning garbage", async () => {
    await expect(openLegacy(linuxStore(), "not-the-password", 1)).rejects.toThrow();
  });

  test("plain JSON has no prefix", () => {
    expect(legacyPrefix(Buffer.from('{"relayUrl":"x"}'))).toBeNull();
  });
});

describe("finding Electron's store", () => {
  test("Electron's folders: the packaged name first, by platform", () => {
    expect(legacyDirs("darwin", "/Users/ana")).toEqual([
      { name: "kiwi-desktop", dir: "/Users/ana/Library/Application Support/kiwi-desktop" },
      { name: "Kiwi", dir: "/Users/ana/Library/Application Support/Kiwi" },
    ]);
    expect(legacyDirs("linux", "/home/ana", {})[0]).toEqual({ name: "kiwi-desktop", dir: "/home/ana/.config/kiwi-desktop" });
    expect(legacyDirs("linux", "/home/ana", { XDG_CONFIG_HOME: "/xdg" })[0]).toEqual({ name: "kiwi-desktop", dir: "/xdg/kiwi-desktop" });
  });

  test("no old store: none", async () => {
    expect(await readLegacyStore(keychain({}), "linux", home(), {})).toEqual({ kind: "none" });
  });

  test("an encrypted Linux store opens with the keyring's password for its name", async () => {
    const h = home();
    const file = put(join(h, ".config", "kiwi-desktop"), linuxStore());
    const read = await readLegacyStore(keychain({ "kiwi-desktop": ELECTRON_LINUX.keyring }), "linux", h, {});
    expect(read).toEqual({ kind: "ok", file, encrypted: true, json: { relayUrl: "https://channels.kiwiinit.com", person: { name: "Ana", pk: "pk", sk: "sk" } } });
  });

  test("a Linux v10 store opens with Chromium's fixed password, without asking the keyring", async () => {
    const h = home();
    put(join(h, ".config", "kiwi-desktop"), chromium("v10", '{"channels":[]}', "peanuts", 1));
    let asked = 0;
    const read = await readLegacyStore(
      async () => {
        asked++;
        return null;
      },
      "linux",
      h,
      {},
    );
    expect(read.kind === "ok" && read.json).toEqual({ channels: [] });
    expect(read.kind === "ok" && read.encrypted).toBe(false);
    expect(asked).toBe(0);
  });

  test("a Mac store opens with the Keychain's password", async () => {
    const h = home();
    put(join(h, "Library", "Application Support", "kiwi-desktop"), chromium("v10", '{"channels":[]}', "pw", 1003));
    const read = await readLegacyStore(keychain({ "kiwi-desktop": "pw" }), "darwin", h, {});
    expect(read.kind === "ok" && read.json).toEqual({ channels: [] });
  });

  test("a plain store (Linux without a keyring) needs no password", async () => {
    const h = home();
    put(join(h, ".config", "kiwi-desktop"), '{"relayUrl":"https://r.example"}');
    const read = await readLegacyStore(keychain({}), "linux", h, {});
    expect(read.kind === "ok" && read.encrypted).toBe(false);
  });

  test("an encrypted store without its password is unreadable, never empty", async () => {
    const h = home();
    const file = put(join(h, ".config", "kiwi-desktop"), linuxStore());
    const read = await readLegacyStore(keychain({}), "linux", h, {});
    expect(read.kind).toBe("unreadable");
    expect(read.kind === "unreadable" && read.file).toBe(file);
  });

  test("a wrong password is unreadable", async () => {
    const h = home();
    put(join(h, ".config", "kiwi-desktop"), linuxStore());
    expect((await readLegacyStore(keychain({ "kiwi-desktop": "nope" }), "linux", h, {})).kind).toBe("unreadable");
  });

  test("damaged plain text is unreadable", async () => {
    const h = home();
    put(join(h, ".config", "kiwi-desktop"), "{not json");
    expect((await readLegacyStore(keychain({}), "linux", h, {})).kind).toBe("unreadable");
  });

  test("a torn store comes back from Electron's backup, asking the keychain once", async () => {
    const h = home();
    const dir = join(h, "Library", "Application Support", "kiwi-desktop");
    const good = chromium("v10", '{"person":null}', "pw", 1003);
    const torn = put(dir, good.subarray(0, 12));
    const bak = put(dir, good, "kiwi-store.bin.bak");
    let asked = 0;
    const read = await readLegacyStore(
      async () => {
        asked++;
        return "pw";
      },
      "darwin",
      h,
      {},
    );
    expect(read).toEqual({ kind: "ok", file: bak, encrypted: true, json: { person: null } });
    expect(asked).toBe(1);
    expect(readFileSync(torn).equals(good.subarray(0, 12))).toBe(true);
  });

  test("an unreadable store stops the search: the old Kiwi folder's is never imported in its place", async () => {
    const h = home();
    const file = put(join(h, ".config", "kiwi-desktop"), linuxStore());
    put(join(h, ".config", "Kiwi"), '{"person":null}');
    const read = await readLegacyStore(keychain({}), "linux", h, {});
    expect(read.kind === "unreadable" && read.file).toBe(file);
  });

  test("with no kiwi-desktop store at all, the Kiwi folder's is read", async () => {
    const h = home();
    put(join(h, ".config", "Kiwi"), '{"person":null}');
    const read = await readLegacyStore(keychain({}), "linux", h, {});
    expect(read.kind === "ok" && read.json).toEqual({ person: null });
  });

  test("a password lookup that throws reads as missing", async () => {
    const h = home();
    const file = put(join(h, ".config", "kiwi-desktop"), linuxStore());
    const read = await readLegacyAt(file, "kiwi-desktop", "linux", () => Promise.reject(new Error("locked")));
    expect(read.kind).toBe("unreadable");
  });
});

describe("the old password's lookup", () => {
  test("Bun looks up the old password only on Linux: on a Mac the signed launcher reads it (T544), and elsewhere there was no Electron app", async () => {
    expect(await legacyPassword("darwin")("kiwi-desktop")).toBeNull();
    expect(await legacyPassword("win32")("kiwi-desktop")).toBeNull();
  });
});
