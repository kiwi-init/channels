import { writeFileSync } from "node:fs";

import { generateIdentity, sign, verify } from "@kiwi/core/identity.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";

import { roomView } from "../engine/view.ts";

const out = process.argv[2];
if (!out) throw new Error("usage: bun ios/scripts/fixture.ts OUT.json");

const people = { jow: "human", lead: "agent", dev: "agent" } as const;
const ids = Object.fromEntries(await Promise.all(Object.keys(people).map(async (n) => [n, await generateIdentity(n)] as const)));
const roster: Roster = Object.entries(people).map(([name, kind]) => ({
  name,
  pk: ids[name]!.pk,
  owner: name === "jow",
  at: 0,
  active: true,
  kind,
  ...(name === "lead" ? { role: "lead" } : {}),
  ...(kind === "agent" ? { runs: { harness: "claude-code", model: "claude-opus-5-5" } } : {}),
  ...(name === "jow" ? { color: "teal" as const } : name === "dev" ? { color: "violet" as const } : {}),
  ...(name === "dev" ? { persona: { name: "Builder", role: "builder", capabilities: [], areas: [], instructions: "" } } : {}),
}));

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
  needs: [
    {
      kind: "spec",
      id: "spec:9:approve:2",
      at: Date.now() - 50 * 60_000,
      ask: 9,
      v: 2,
      changed: false,
      title: "The iPhone app is your away-from-desk Needs you",
      text: "- Allow or deny tool permissions\n- Let in join requests after comparing the code\n- Approve specs that are ready",
      by: "lead",
    },
    {
      kind: "permission",
      id: "permission-1",
      from: "dev",
      at: Date.now() - 3 * 60_000,
      title: "Run a command",
      summary: "Push the branch so CI can run",
      code: "git push -u origin Channels9-ios-ui",
      cwd: null,
      canAllow: true,
      allower: null,
      expiresAt: null,
      task: 12,
    },
    {
      kind: "join",
      id: "join-1",
      at: Date.now() - 60_000,
      name: "eager-heron",
      who: "agent",
      runs: "Claude Code · claude-opus-5-5",
      machine: "macOS arm64",
      sponsor: null,
      code: "369329",
      pinned: false,
    },
  ],
});
const ago = (min: number) => Date.now() - min * 60_000;
const task = (id: number, title: string, state: "todo" | "doing" | "review" | "done", owner: string | null, min: number) => ({
  id,
  title,
  state,
  owner,
  review: null,
  updatedAt: ago(min),
  createdAt: ago(min + 120),
  last: null,
  archived: false,
});
const tasks = [
  task(12, "Composer empties after Send, every time", "doing", "dev", 2),
  task(14, "Role faces on the iPhone", "review", "dev", 30),
  task(15, "Search across channels", "todo", null, 90),
  task(9, "Needs you cards on the phone", "done", "dev", 240),
];
const members = room.members.map((m) => (m.name === "dev" ? { ...m, activity: { state: "working", tool: "Edit", since: ago(2) }, doing: [12] } : m));
writeFileSync(out, JSON.stringify({ ...room, tasks, members }));
