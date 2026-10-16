import { afterEach, describe, expect, test } from "bun:test";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { legacyDirs, legacyPrefix, legacyRounds, openLegacy, readLegacyAt, readLegacyStore, type LegacyName } from "../desktop/src/legacy-store.ts";

const ELECTRON_LINUX = {
  password: "gk2sW4WabwOsnX/FPdTgOw==",
  vectors: [
    { plain: '{"relayUrl":"https://channels.kiwiinit.com","person":{"name":"Ana","pk":"pk","sk":"sk"}}', b64: "djExfzEdBihniNSHGn40wWj+eLU2/GoIxM/mIb6cd9l+wnmyRIDBxNGCC3uCYEFov+6+gqGDdm2JtVg5rkEIGdmNRGARNCeJHbBV3amjKV1mLoR5rL5Kg6DoPl1dE4Xmgdc1" },
    { plain: "xxxxxxxxxxxxxxxx", b64: "djExOC714415uFqY9hxSaOgqsHSx2b41e8iOg6ILb6c2XC0=" },
    { plain: "ção ✓", b64: "djExAoiRD+eqALOOnTfTckl9PQ==" },
  ],
};

function chromiumMac(plain: string, password: string): Buffer {
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const c = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from("v10"), c.update(plain, "utf8"), c.final()]);
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

function put(dir: string, raw: Buffer | string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "kiwi-store.bin");
  writeFileSync(file, raw);
  return file;
}

const keychain = (entries: Partial<Record<LegacyName, string>>) => async (name: LegacyName): Promise<string | null> => entries[name] ?? null;

describe("Electron safeStorage ciphertext", () => {
  test("opens what Electron 44.7.2 wrote with a GNOME keyring (v11)", async () => {
    for (const v of ELECTRON_LINUX.vectors) {
      const raw = Buffer.from(v.b64, "base64");
      expect(legacyPrefix(raw)).toBe("v11");
      expect(await openLegacy(raw, ELECTRON_LINUX.password, legacyRounds("linux"))).toBe(v.plain);
    }
  });

  test("opens Chromium's macOS format (v10, 1003 rounds)", async () => {
    const raw = chromiumMac('{"person":null}', "mac-keychain-password");
    expect(legacyPrefix(raw)).toBe("v10");
    expect(await openLegacy(raw, "mac-keychain-password", legacyRounds("darwin"))).toBe('{"person":null}');
  });

  test("a wrong key fails instead of returning garbage", async () => {
    const raw = Buffer.from(ELECTRON_LINUX.vectors[0]!.b64, "base64");
    await expect(openLegacy(raw, "not-the-password", 1)).rejects.toThrow();
  });

  test("plain JSON has no prefix", () => {
    expect(legacyPrefix(Buffer.from('{"relayUrl":"x"}'))).toBeNull();
  });
});

describe("finding 0.14's store", () => {
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
    const file = put(join(h, ".config", "kiwi-desktop"), Buffer.from(ELECTRON_LINUX.vectors[0]!.b64, "base64"));
    const read = await readLegacyStore(keychain({ "kiwi-desktop": ELECTRON_LINUX.password }), "linux", h, {});
    expect(read).toEqual({ kind: "ok", file, encrypted: true, json: { relayUrl: "https://channels.kiwiinit.com", person: { name: "Ana", pk: "pk", sk: "sk" } } });
  });

  test("a Mac store opens with the Keychain's password", async () => {
    const h = home();
    put(join(h, "Library", "Application Support", "kiwi-desktop"), chromiumMac('{"channels":[]}', "pw"));
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
    const file = put(join(h, ".config", "kiwi-desktop"), Buffer.from(ELECTRON_LINUX.vectors[0]!.b64, "base64"));
    const read = await readLegacyStore(keychain({}), "linux", h, {});
    expect(read.kind).toBe("unreadable");
    expect(read.kind === "unreadable" && read.file).toBe(file);
  });

  test("a wrong password is unreadable", async () => {
    const h = home();
    put(join(h, ".config", "kiwi-desktop"), Buffer.from(ELECTRON_LINUX.vectors[0]!.b64, "base64"));
    expect((await readLegacyStore(keychain({ "kiwi-desktop": "nope" }), "linux", h, {})).kind).toBe("unreadable");
  });

  test("damaged plain text is unreadable", async () => {
    const h = home();
    put(join(h, ".config", "kiwi-desktop"), "{not json");
    expect((await readLegacyStore(keychain({}), "linux", h, {})).kind).toBe("unreadable");
  });

  test("a readable store under the other name wins over an unreadable one", async () => {
    const h = home();
    put(join(h, ".config", "kiwi-desktop"), "{not json");
    put(join(h, ".config", "Kiwi"), '{"person":null}');
    const read = await readLegacyStore(keychain({}), "linux", h, {});
    expect(read.kind === "ok" && read.json).toEqual({ person: null });
  });

  test("a password lookup that throws reads as missing", async () => {
    const h = home();
    const file = put(join(h, ".config", "kiwi-desktop"), Buffer.from(ELECTRON_LINUX.vectors[0]!.b64, "base64"));
    const read = await readLegacyAt(file, "kiwi-desktop", 1, () => Promise.reject(new Error("locked")));
    expect(read.kind).toBe("unreadable");
  });
});
