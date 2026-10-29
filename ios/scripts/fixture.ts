import { writeFileSync } from "node:fs";

import { generateIdentity, sign, verify } from "@kiwi/core/identity.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";

import { roomView } from "../engine/view.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: bun ios/scripts/fixture.ts OUT.json");

const people = { jow: "human", lead: "agent", dev: "agent" } as const;
const ids = Object.fromEntries(await Promise.all(Object.keys(people).map(async (n) => [n, await generateIdentity(n)] as const)));
const roster: Roster = Object.entries(people).map(([name, kind]) => ({ name, pk: ids[name]!.pk, owner: name === "jow", at: 0, active: true, kind, ...(name === "lead" ? { role: "lead" } : {}) }));

const long = (n: number) =>
  [
    `Round ${n} is in main. At a 150 ms round trip:`,
    "- reload to the first screen: 768 ms → 265 ms",
    "- your message on screen after Enter: 200 ms → 7 ms",
    "- no false Add an agent / No tasks yet screens on load",
    "- no rows jumping, panels slide over instead of squeezing",
    "- CI now fails if any of that slides back",
  ].join("\n");

const said: [string, string][] = [];
for (let n = 1; n <= 6; n++) said.push(["jow", `progress update ${n}?`], [n % 2 ? "lead" : "dev", long(n)]);
said.push(["lead", "Notes in https://example.com/release"]);

const start = Date.now() - said.length * 60_000;
const log: Message[] = [];
for (const [i, [from, body]] of said.entries()) {
  const ts = start + i * 60_000;
  const signed = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "msg" as const, body, ts });
  log.push({ ...signed, seq: i + 1, rts: ts, sigOk: await verify(signed) });
}

const room = roomView({
  code: "fixture",
  title: "channels-dev",
  icon: null,
  me: "jow",
  isOwner: true,
  connection: "live",
  gone: null,
  error: null,
  head: log.length,
  whole: true,
  messages: log,
  state: fold(log, roster, Date.now()),
  online: new Map(),
  place: "main",
});
writeFileSync(out, JSON.stringify(room));
