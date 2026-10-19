import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { fold, placeKey, type Roster } from "@kiwi/core/state.ts";
import { cardShown, lastLine, liveCard, taskRoom, unreadAll, unreadIn } from "@kiwi/core/standup.ts";

let seq = 0;
const T0 = 1_700_000_000_000;
async function msg(id: Identity, init: { kind?: Kind; ev?: Event; to?: string[]; re?: number[]; body?: string; at?: number; task?: number } = {}): Promise<Message> {
  seq++;
  const ts = init.at ?? T0 + seq * 1000;
  const base = {
    v: 1 as const,
    id: crypto.randomUUID(),
    from: id.name,
    kind: init.kind ?? (init.ev ? "event" : "msg"),
    body: init.body ?? "",
    ts,
    ...(init.to ? { to: init.to } : {}),
    ...(init.re ? { re: init.re } : {}),
    ...(init.ev ? { ev: init.ev } : {}),
    ...(init.task !== undefined ? { task: init.task } : {}),
  };
  const p = await sign(id, base);
  return { ...p, seq, rts: ts, sigOk: await verify(p) };
}

let owner: Identity, coord: Identity, ann: Identity, bob: Identity;
let roster: Roster;
beforeAll(async () => {
  [owner, coord, ann, bob] = await Promise.all([generateIdentity("jonatas"), generateIdentity("coord"), generateIdentity("ann"), generateIdentity("bob")]);
  roster = [
    { name: "jonatas", pk: owner.pk, owner: true, at: T0, active: true, kind: "human" },
    { name: "coord", pk: coord.pk, owner: false, at: T0, active: true, role: "coordinator" },
    { name: "ann", pk: ann.pk, owner: false, at: T0, active: true, role: "backend" },
    { name: "bob", pk: bob.pk, owner: false, at: T0, active: true, role: "frontend" },
  ];
});

describe("the live card's last line", () => {
  test("the newest status wins over a newer note and newer chat", async () => {
    const add = await msg(ann, { ev: { op: "task.add", title: "Fewer writes", owner: "ann" } });
    const status = await msg(ann, { kind: "status", task: add.seq, body: "halfway through the rows" });
    const note = await msg(ann, { ev: { op: "task.update", task: add.seq, note: "measuring" } });
    const chat = await msg(bob, { task: add.seq, body: "looks good" });
    const ms = [add, status, note, chat];
    const s = fold(ms, roster);
    expect(lastLine(s, ms, add.seq)).toMatchObject({ from: "ann", text: "halfway through the rows", seq: status.seq });
  });

  test("without a status, the newest task.update note, then chat", async () => {
    const add = await msg(ann, { ev: { op: "task.add", title: "Fewer writes", owner: "ann" } });
    const chat = await msg(bob, { task: add.seq, body: "looks good" });
    const note = await msg(ann, { ev: { op: "task.update", task: add.seq, note: "measuring" } });
    const later = await msg(bob, { task: add.seq, body: "ping" });
    const s = fold([add, chat, note, later], roster);
    expect(lastLine(s, [add, chat, note, later], add.seq)).toMatchObject({ text: "measuring", seq: note.seq });
    expect(lastLine(s, [add, chat, later], add.seq)).toMatchObject({ from: "bob", text: "ping" });
    expect(lastLine(s, [add], add.seq)).toBeUndefined();
  });

  test("a line is one line of at most 140 characters, and other tasks' talk is not this task's", async () => {
    const add = await msg(ann, { ev: { op: "task.add", title: "A", owner: "ann" } });
    const other = await msg(ann, { ev: { op: "task.add", title: "B", owner: "ann" } });
    const long = await msg(ann, { kind: "status", task: add.seq, body: `first\n${"x".repeat(300)}` });
    const elsewhere = await msg(ann, { kind: "status", task: other.seq, body: "on the other one" });
    const ms = [add, other, long, elsewhere];
    const s = fold(ms, roster);
    const line = lastLine(s, ms, add.seq)!;
    expect(line.text.length).toBe(140);
    expect(line.text.startsWith("first xxx")).toBe(true);
  });
});

describe("per-viewer unread", () => {
  test("counts what arrived in the place after the viewer's last look, not their own", async () => {
    const add = await msg(ann, { ev: { op: "task.add", title: "A", owner: "ann" } });
    const a = await msg(ann, { task: add.seq, body: "one" });
    const b = await msg(bob, { task: add.seq, body: "two" });
    const c = await msg(ann, { task: add.seq, body: "three" });
    const react = await msg(bob, { ev: { op: "react", seq: a.seq, emoji: "👍" } });
    const ms = [add, a, b, c, react];
    const s = fold(ms, roster);
    const key = placeKey({ kind: "task", task: add.seq });
    expect(unreadIn(s, ms, "bob", key, 0)).toMatchObject({ n: 2 });
    expect(unreadIn(s, ms, "bob", key, b.seq).n).toBe(1);
    expect(unreadIn(s, ms, "bob", key, c.seq).n).toBe(0);
    expect(unreadIn(s, ms, "ann", key, 0).n).toBe(1);
  });

  test("one pass for every place gives what asking each place gives, for every viewer and last look", async () => {
    const ms: Message[] = [];
    const tasks: number[] = [];
    for (let i = 0; i < 4; i++) {
      const add = await msg([ann, bob][i % 2]!, { ev: { op: "task.add", title: `T${i}`, owner: i % 2 ? "bob" : "ann" } });
      ms.push(add);
      tasks.push(add.seq);
    }
    for (let i = 0; i < 40; i++) {
      const from = [ann, bob, owner][i % 3]!;
      const task = i % 4 === 3 ? undefined : tasks[i % tasks.length];
      ms.push(await msg(from, { body: `m${i}`, ...(task !== undefined ? { task } : {}), ...(i % 5 === 0 ? { to: [["ann", "bob", "jonatas"][(i + 1) % 3]!] } : {}) }));
      if (i % 9 === 0) ms.push(await msg(bob, { ev: { op: "react", seq: ms.at(-1)!.seq, emoji: "👀" } }));
    }
    const s = fold(ms, roster);
    const keys = [...s.places.keys(), "main", placeKey({ kind: "task", task: 999 })];
    for (const viewer of ["ann", "bob", "jonatas"])
      for (const cut of [0, ms[10]!.seq, ms[30]!.seq]) {
        const seen = Object.fromEntries(keys.map((k, i) => [k, i % 2 ? cut : 0]));
        const all = unreadAll(s, ms, viewer, seen);
        for (const k of keys) expect(all(k)).toEqual(unreadIn(s, ms, viewer, k, seen[k] ?? 0));
      }
  });
});

describe("the live card", () => {
  test("carries the task, who works it, how many messages, the last line and whether the viewer is waited on", async () => {
    const add = await msg(ann, { ev: { op: "task.add", title: "Fewer writes", owner: "ann", review: "bob" } });
    const say = await msg(ann, { task: add.seq, body: "ready" });
    const ready = await msg(ann, { ev: { op: "task.update", task: add.seq, state: "review" } });
    const ms = [add, say, ready];
    const s = fold(ms, roster);
    expect(liveCard(s, ms, add.seq, "bob")).toMatchObject({ people: ["ann"], said: 1, lastLine: { text: "ready" }, waiting: true });
    expect(liveCard(s, ms, add.seq, "ann")?.waiting).toBe(false);
    expect(liveCard(s, ms, 9999, "bob")).toBeUndefined();
  });
});

describe("a task's room", () => {
  test("is the room its conversation is in, and general when it has none", async () => {
    const create = await msg(owner, { ev: { op: "room.create", id: "design", name: "design" } });
    const add = await msg(ann, { ev: { op: "task.add", title: "A", owner: "ann" } });
    const quiet = await msg(ann, { ev: { op: "task.add", title: "B", owner: "ann" } });
    const said = { ...(await msg(ann, { task: add.seq, body: "sketching" })), room: "design" };
    const ms = [create, add, quiet, said];
    const s = fold(ms, roster);
    expect(taskRoom(s, ms, add.seq)).toBe("design");
    expect(taskRoom(s, ms, quiet.seq)).toBe("general");
    expect(cardShown(s, ms, add.seq, "general")).toBe(true);
    expect(cardShown(s, ms, quiet.seq, "general")).toBe(true);
    expect(cardShown(s, ms, add.seq, "design")).toBe(true);
    expect(cardShown(s, ms, quiet.seq, "design")).toBe(false);
  });
});
