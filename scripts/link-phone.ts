import { createInterface } from "node:readline/promises";

import { createLinkHost } from "../desktop/src/link-host.ts";
import { renderUnicodeCompact } from "../web/node_modules/uqr/dist/index.mjs";
import { readDesktopStore } from "./desktop-store.ts";

const LINK_WINDOW_MS = 9 * 60_000;

const store = readDesktopStore();
const person = store.person;
if (!person) throw new Error("the desktop app has no person yet: open Kiwi and finish first run");
console.log(`read the desktop store: ${person.name}, ${store.channels.length} channels, relay ${store.relayUrl}`);

const host = createLinkHost({
  relayUrl: () => store.relayUrl,
  person: () => person,
  channels: () => store.channels,
  linked: () => {},
});

const { code } = await host.begin();
console.log(`\nOn the phone: Kiwi → Link this phone → scan this, or paste the code below.\n`);
console.log(renderUnicodeCompact(code, { border: 1 }));
console.log(`\n${code}\n`);
console.log("Waiting for the phone (up to 9 minutes)…");

const deadline = Date.now() + LINK_WINDOW_MS;
let ask: Awaited<ReturnType<typeof host.poll>> = null;
while (!ask && Date.now() < deadline) ask = await host.poll();
if (!ask) {
  await host.cancel();
  throw new Error("no phone answered in time: run this again");
}

console.log(`\n${ask.label} wants to become ${person.name}.\nIts screen should show: ${ask.digits}\n`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const reply = (await rl.question("Same six digits on the phone? Type yes to link, anything else to refuse: ")).trim().toLowerCase();
rl.close();

const phone = await host.answer(reply === "yes");
console.log(phone ? `\nlinked: ${phone.label} is now ${person.name}, with the same keys and channels.` : "\nrefused: nothing was sent.");
