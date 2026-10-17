import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { generatePassphrase, putBackup, sealBackup } from "../src/backup.ts";
import { signIn } from "../src/signin.ts";

interface Store {
  relayUrl: string;
  person: object | null;
  channels: object[];
  signin?: { access: string; exp: number };
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dry = args.includes("--dry");
const folder = flag("dir") ?? join(homedir(), "Library", "Application Support", "kiwi-desktop");
const service = flag("keychain") ?? "kiwi-desktop Safe Storage";

const password = execFileSync("security", ["find-generic-password", "-w", "-s", service], {
  encoding: "utf8",
}).trim();
const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
const raw = readFileSync(join(folder, "kiwi-store.bin"));
if (raw.subarray(0, 3).toString("latin1") !== "v10")
  throw new Error("this store is not an encrypted macOS store");
const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
const store = JSON.parse(
  Buffer.concat([decipher.update(raw.subarray(3)), decipher.final()]).toString("utf8"),
) as Store;

if (!store.person) throw new Error("the store has no person key");
console.log(
  `read the store: person ${(store.person as { name?: string }).name ?? "?"}, ${store.channels.length} channel identities, relay ${store.relayUrl}`,
);
if (dry) process.exit(0);

const relay = flag("relay") ?? store.relayUrl;
const saved = store.signin && Date.now() < store.signin.exp - 60_000 ? store.signin.access : null;
const token =
  saved ??
  (await signIn(
    {
      relay,
      devName: "dev",
      open: async (url) => {
        execFileSync("open", [url]);
      },
    },
    (step) => {
      if (step.step === "waiting")
        console.log(`Finish signing in in the browser that opened (code ${step.userCode}).`);
    },
  ));
const passphrase = generatePassphrase();
await putBackup(
  relay,
  token,
  await sealBackup(passphrase, { person: store.person, channels: store.channels }),
);
console.log(
  `\nbacked up to ${relay}.\n\nRecovery passphrase (shown once, write it down):\n\n  ${passphrase}\n`,
);
