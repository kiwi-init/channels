import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { renderUnicodeCompact } from "uqr";

import { createLinkHost } from "../desktop/src/link-host.ts";
import type { ChannelIdentityView, PersonView } from "../desktop/src/bridge.ts";

interface Store {
  relayUrl: string;
  person: PersonView | null;
  channels: ChannelIdentityView[];
}

const args = process.argv.slice(2);
const flag = (name: string): string | undefined =>
  args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
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
const person = store.person;
const relay = flag("relay") ?? store.relayUrl;
console.log(
  `Linking as ${person.name}: ${store.channels.length} channel identities, relay ${relay}.\n`,
);
if (args.includes("--dry")) process.exit(0);

const host = createLinkHost({
  relayUrl: () => relay,
  person: () => person,
  channels: () => store.channels,
  linked: () => {},
});

const { code } = await host.begin();
console.log(renderUnicodeCompact(code));
console.log(`\n${code}\n`);
console.log("Open Kiwi on the phone → I already use Kiwi → scan this. Waiting for the phone…\n");

let ask = null;
while (!ask) ask = await host.poll();
const d = ask.digits;
console.log(
  `"${ask.label}" is asking to link. Numbers on the phone must read: ${d.slice(0, 3)} ${d.slice(3)}`,
);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const yes =
  (await rl.question("Do they match? Type yes to link, anything else to refuse: "))
    .trim()
    .toLowerCase() === "yes";
rl.close();
const done = await host.answer(yes);
console.log(
  done
    ? `\nLinked ${done.label}. The phone has the same person and channels.`
    : "\nRefused. Nothing was sent.",
);
process.exit(0);
