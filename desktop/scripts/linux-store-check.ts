import { execFileSync } from "node:child_process";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { keySources } from "../src/launcher-key.ts";
import { ebDataDir, openEbStore, plainNote } from "../src/store-eb.ts";
import { readyMark, STORE_FILE } from "../src/store-v2.ts";

const mode = process.argv[2];
if (process.platform !== "linux" || (mode !== "keyring" && mode !== "none")) {
  console.error("usage on Linux: bun desktop/scripts/linux-store-check.ts keyring (inside a session with an unlocked Secret Service) | none (with no session bus)");
  process.exit(2);
}

const failures: string[] = [];
function expect(what: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) failures.push(`${what}: ${detail}`);
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-linux-store-"));
const id = `com.kiwiinit.channels.store-check-${randomBytes(4).toString("hex")}`;
const dir = ebDataDir(id, "stable", "linux", home, {});
const store = path.join(dir, STORE_FILE);
const privateFile = (file: string): boolean => fs.existsSync(file) && (fs.statSync(file).mode & 0o777) === 0o600;
const open = () => openEbStore({ dir, keys: keySources("linux"), home, platform: "linux" });

try {
  if (mode === "keyring") {
    const password = randomBytes(16).toString("base64");
    execFileSync("secret-tool", ["store", "--label", "kiwi-desktop Safe Storage", "xdg:schema", "chrome_libsecret_os_crypt_password_v2", "application", "kiwi-desktop"], { input: password });
    const old = { relayUrl: "https://old.example", channels: [] };
    const legacyDir = path.join(home, ".config", "kiwi-desktop");
    fs.mkdirSync(legacyDir, { recursive: true });
    const cipher = createCipheriv("aes-128-cbc", pbkdf2Sync(password, "saltysalt", 1, 16, "sha1"), Buffer.alloc(16, 0x20));
    const legacy = path.join(legacyDir, "kiwi-store.bin");
    fs.writeFileSync(legacy, Buffer.concat([Buffer.from("v11"), cipher.update(JSON.stringify(old), "utf8"), cipher.final()]));
    const first = await open();
    expect(
      "a first start imports the Electron app's v11 store through the GNOME keyring's kiwi-desktop Safe Storage, sealed under a key the keyring keeps",
      first.kind === "open" && first.sealed && first.imported === legacy && first.json?.["relayUrl"] === old.relayUrl && first.noKeychain === null,
      JSON.stringify(first),
    );
    expect("both copies are 0600", privateFile(store) && privateFile(`${store}.bak`), `${store}`);
    const key = await Bun.secrets.get({ service: "Channels", name: "store-key" });
    expect(
      "the store key and its ready mark are in the keyring",
      key !== null && (await Bun.secrets.get({ service: "Channels", name: "store-key-ready" })) === readyMark(key),
      `key ${key === null ? "missing" : "present"}`,
    );
    const second = await open();
    expect("the next start reads store v2 and doesn't import again", second.kind === "open" && second.imported === null && second.json?.["relayUrl"] === old.relayUrl, JSON.stringify(second));
    expect("the Electron app's file is left as it was", fs.existsSync(legacy), legacy);
  } else {
    const opened = await open();
    const note = plainNote(opened);
    expect(
      "with no Secret Service, the store opens in plain JSON and says why, for main.log",
      opened.kind === "open" && !opened.sealed && opened.noKeychain !== null && note !== null && note.includes("without encryption"),
      JSON.stringify(opened),
    );
    expect("and saves it at 0600", privateFile(store) && fs.readFileSync(store, "utf8") === "{}", store);
  }
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`linux-store-check: ${failures.length} failed\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`linux-store-check (${mode}): the Linux store holds`);
