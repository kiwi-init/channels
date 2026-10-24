import { afterEach, describe, expect, test } from "bun:test";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { kwalletKeys, legacyPairs, legacyPassword, replyValue, type DBusCall } from "../desktop/src/legacy-keys.ts";
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
  async (name: LegacyName): Promise<string[]> => {
    const key = entries[name];
    return key ? [key] : [];
  };

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
    expect(legacyDirs("linux", "/home/ana", { XDG_CONFIG_HOME: "relative/config" })[0]).toEqual({ name: "kiwi-desktop", dir: "/home/ana/.config/kiwi-desktop" });
    expect(legacyDirs("linux", "/home/ana", { XDG_CONFIG_HOME: "/cfg" })[0]).toEqual({ name: "kiwi-desktop", dir: "/cfg/kiwi-desktop" });
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
        return [];
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
        return ["pw"];
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

  test("a newer encrypted store whose key the keychain won't give isn't passed over for an older .bak", async () => {
    const h = home();
    const file = put(join(h, ".config", "kiwi-desktop"), linuxStore());
    put(join(h, ".config", "kiwi-desktop"), '{"person":{"name":"older"}}', "kiwi-store.bin.bak");
    const read = await readLegacyStore(keychain({}), "linux", h, {});
    expect(read.kind === "unreadable" && read.file).toBe(file);
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
    expect(await legacyPassword("darwin")("kiwi-desktop")).toEqual([]);
    expect(await legacyPassword("win32")("kiwi-desktop")).toEqual([]);
  });
});

describe("the old app's key in KDE's wallet (T472, Jow's KDE machine)", () => {
  type Wallet = { service: string; enabled?: boolean; wallet?: string; handle?: number; entries: Record<string, string> };
  const fakeBus = (wallets: Wallet[]) => {
    const calls: string[] = [];
    const call: DBusCall = async (dest, _path, method, args) => {
      calls.push([dest, method, ...args].join(" "));
      const w = wallets.find((x) => x.service === dest);
      if (!w) return null;
      const say = (line: string) => `method return time=1 sender=:1.9 -> destination=:1.42 serial=7 reply_serial=2\n   ${line}\n`;
      if (method === "isEnabled") return say(`boolean ${w.enabled !== false}`);
      if (method === "networkWallet") return say(`string "${w.wallet ?? "kdewallet"}"`);
      if (method === "open") return say(`int32 ${w.handle ?? 7}`);
      if (method === "readPassword") return say(`string "${w.entries[`${args[1]!.slice(7)}/${args[2]!.slice(7)}`] ?? ""}"`);
      if (method === "close") return say("int32 0");
      return null;
    };
    return { call, calls };
  };

  test("every folder and entry name the old app could have used is tried: Electron's own, and Chromium's defaults", () => {
    expect(legacyPairs("kiwi-desktop")).toEqual([
      ["kiwi-desktop Keys", "kiwi-desktop Safe Storage"],
      ["kiwi-desktop Keys", "Chromium Safe Storage"],
      ["Chromium Keys", "kiwi-desktop Safe Storage"],
      ["Chromium Keys", "Chromium Safe Storage"],
    ]);
  });

  test("Plasma 6's wallet answers with the key kept under Chromium's names, read from the network wallet the person named, and closed after", async () => {
    const bus = fakeBus([{ service: "org.kde.kwalletd6", wallet: "Personal", handle: 12, entries: { "Chromium Keys/Chromium Safe Storage": "gk2sW4WabwOsnX/FPdTgOw==" } }]);
    expect(await kwalletKeys("kiwi-desktop", bus.call)).toEqual(["gk2sW4WabwOsnX/FPdTgOw=="]);
    expect(bus.calls).toContain("org.kde.kwalletd6 open string:Personal int64:0 string:kiwi-desktop");
    expect(bus.calls).toContain("org.kde.kwalletd6 readPassword int32:12 string:Chromium Keys string:Chromium Safe Storage string:kiwi-desktop");
    expect(bus.calls.at(-1)).toBe("org.kde.kwalletd6 close int32:12 boolean:false string:kiwi-desktop");
  });

  test("Plasma 5's wallet is asked when Plasma 6's isn't there, and both of the old app's entries come back, its own first", async () => {
    const bus = fakeBus([{ service: "org.kde.kwalletd5", entries: { "kiwi-desktop Keys/kiwi-desktop Safe Storage": "own", "Chromium Keys/Chromium Safe Storage": "chromium" } }]);
    expect(await kwalletKeys("kiwi-desktop", bus.call)).toEqual(["own", "chromium"]);
    expect(bus.calls[0]).toBe("org.kde.kwalletd6 isEnabled");
  });

  test("a wallet that's off, or a locked one whose prompt the person dismissed, gives no key rather than an error", async () => {
    expect(await kwalletKeys("kiwi-desktop", fakeBus([{ service: "org.kde.kwalletd6", enabled: false, entries: { "Chromium Keys/Chromium Safe Storage": "x" } }]).call)).toEqual([]);
    expect(await kwalletKeys("kiwi-desktop", fakeBus([{ service: "org.kde.kwalletd6", handle: -1, entries: { "Chromium Keys/Chromium Safe Storage": "x" } }]).call)).toEqual([]);
    expect(await kwalletKeys("kiwi-desktop", fakeBus([]).call)).toEqual([]);
  });

  test("dbus-send's replies read back as their value", () => {
    expect(replyValue('method return time=1 sender=:1.9 -> destination=:1.42 serial=7 reply_serial=2\n   string "kdewallet"\n')).toBe("kdewallet");
    expect(replyValue("method return time=1\n   int32 -1\n")).toBe("-1");
    expect(replyValue("method return time=1\n   boolean true\n")).toBe("true");
    expect(replyValue(null)).toBeNull();
  });

  test("the real call goes through dbus-send on the session bus, with the wallet's prompt given two minutes", async () => {
    const bin = mkdtempSync(join(tmpdir(), "kiwi-dbus-send-"));
    homes.push(bin);
    const log = join(bin, "calls");
    writeFileSync(
      join(bin, "dbus-send"),
      `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$6" in
  *.isEnabled) printf 'method return\\n   boolean true\\n' ;;
  *.networkWallet) printf 'method return\\n   string "kdewallet"\\n' ;;
  *.open) printf 'method return\\n   int32 3\\n' ;;
  *.readPassword) [ "$9" = "string:Chromium Safe Storage" ] && printf 'method return\\n   string "the-key"\\n' || printf 'method return\\n   string ""\\n' ;;
  *) printf 'method return\\n   int32 0\\n' ;;
esac
`,
    );
    chmodSync(join(bin, "dbus-send"), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
    try {
      expect(await kwalletKeys("kiwi-desktop")).toEqual(["the-key"]);
    } finally {
      process.env.PATH = path;
    }
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls).toContain("--session --print-reply --reply-timeout=120000 --dest=org.kde.kwalletd6 /modules/kwalletd6 org.kde.KWallet.open string:kdewallet int64:0 string:kiwi-desktop");
  });

  test("on Linux the old store opens with the wallet's key even when the Secret Service gives a wrong one first", async () => {
    const h = home();
    put(join(h, ".config", "kiwi-desktop"), linuxStore());
    const password = legacyPassword(
      "linux",
      async () => [ELECTRON_LINUX.keyring],
      () => ["not-this-one"],
    );
    const read = await readLegacyStore(password, "linux", h, {});
    expect(read.kind).toBe("ok");
    expect(read.kind === "ok" && read.encrypted).toBe(true);
  });

  test("with no key anywhere, it says where Channels looked, and that nothing was opened", async () => {
    const h = home();
    put(join(h, ".config", "kiwi-desktop"), linuxStore());
    const read = await readLegacyStore(
      legacyPassword(
        "linux",
        async () => [],
        () => [],
      ),
      "linux",
      h,
      {},
    );
    expect(read).toMatchObject({ kind: "unreadable", keyless: true });
    expect(read.kind === "unreadable" && read.why).toContain("neither in KDE's wallet nor in your Secret Service");
  });
});
