// The Work view's data (src/work.ts): agent rows, what needs a person, PRs, and a task's feed,
// including what strict coordinator-only mode keeps from people.

import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { agentRows, needsPerson, prLinks, prsIn, recentPrs, taskFeed, taskPrs } from "@kiwi/core/work.ts";

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

describe("pull requests", () => {
  test("links are read from text, each once; a later message saying merged marks it", async () => {
    expect(prLinks("see https://github.com/o/r/pull/49 and https://github.com/o/r/pull/49 again")).toEqual([{ url: "https://github.com/o/r/pull/49", repo: "o/r", number: 49 }]);
    const linked = await msg(ann, { body: "PR: https://github.com/o/r/pull/49" });
    const merged = await msg(coord, { body: "Merged #49 and shipped it." });
    const ms = [linked, merged];
    const s = fold(ms, roster);
    expect(prsIn(s, ms, "jonatas", (m) => m.from === "ann")).toMatchObject([{ number: 49, state: "merged", seq: linked.seq }]);
  });

  test("recent PRs: newest mention first, cut to the limit, with the task that named them", async () => {
    const add = await msg(ann, { ev: { op: "task.add", title: "Keys move out", owner: "ann" } });
    const a = await msg(ann, { body: `T${add.seq} is up: https://github.com/o/r/pull/1` });
    const b = await msg(bob, { body: "https://github.com/o/r/pull/2" });
    const c = await msg(coord, { body: "https://github.com/o/r/pull/3" });
    const merged = await msg(coord, { body: "merged #3" });
    const again = await msg(coord, { body: "back on https://github.com/o/r/pull/1" });
    const ms = [add, a, b, c, merged, again];
    const s = fold(ms, roster);
    const recent = recentPrs(s, ms, "jonatas", 2);
    expect(recent.map((p) => p.number)).toEqual([1, 3]);
    expect(recent[0]).toMatchObject({ by: "coord", last: again.rts, task: add.seq, state: "open" });
    expect(recent[1]).toMatchObject({ state: "merged" });
  });

  test("recent PRs: the task a message names wins over the task thread it was sent in", async () => {
    const doing = await msg(ann, { ev: { op: "task.add", title: "Keys move out", owner: "ann" } });
    const other = await msg(ann, { ev: { op: "task.add", title: "Faces go", owner: "ann" } });
    const link = await msg(ann, { task: doing.seq, body: `T${other.seq} is up: https://github.com/o/r/pull/7` });
    const ms = [doing, other, link];
    const s = fold(ms, roster);
    expect(recentPrs(s, ms, "jonatas", 5)[0]).toMatchObject({ number: 7, task: other.seq });
  });

  test("recent PRs: a reply in a task's thread ties its PR to that task", async () => {
    const add = await msg(ann, { ev: { op: "task.add", title: "Keys move out", owner: "ann" } });
    const root = await msg(ann, { task: add.seq, body: "starting" });
    const reply = await msg(bob, { re: [root.seq], body: "up: https://github.com/o/r/pull/9" });
    const ms = [add, root, reply];
    const s = fold(ms, roster);
    expect(recentPrs(s, ms, "jonatas", 5)[0]).toMatchObject({ number: 9, task: add.seq });
  });
});

describe("agent rows", () => {
  test("working, blocked, idle and offline; the status line prefers a status message", async () => {
    const add = await msg(ann, { ev: { op: "task.add", title: "Fewer writes", owner: "ann" } });
    const start = await msg(ann, { ev: { op: "task.update", task: add.seq, state: "doing", note: "measuring" } });
    const status = await msg(ann, { kind: "status", body: "halfway through the rows" });
    const chat = await msg(ann, { body: "lunch?" });
    const addB = await msg(bob, { ev: { op: "task.add", title: "Feed", owner: "bob" } });
    // Blocked is a blocking question nobody has answered yet (tasks have no blocked state now).
    const block = await msg(bob, { kind: "blocking", body: "waiting on tokens", to: ["jonatas"] });
    const ms = [add, start, status, chat, addB, block];
    const s = fold(ms, roster);
    const now = T0 + 60 * 60_000;
    const rows = agentRows(s, ms, "jonatas", new Set(["ann"]), now);
    const ann_ = rows.find((r) => r.name === "ann")!;
    const bob_ = rows.find((r) => r.name === "bob")!;
    const coord_ = rows.find((r) => r.name === "coord")!;
    expect(ann_).toMatchObject({ status: "working", doing: { title: "Fewer writes" }, statusLine: { text: "halfway through the rows" } });
    expect(bob_).toMatchObject({ status: "blocked", statusLine: { text: "waiting on tokens" } });
    expect(coord_.status).toBe("offline");
    expect(rows[0]!.name).toBe("bob"); // blocked first
    expect(rows.some((r) => r.name === "jonatas")).toBe(false); // people aren't agent rows
  });

  test("strict coordinator-only: a person's view never takes a status line from an agent's chat with another agent", async () => {
    const mode = await msg(owner, { ev: { op: "mode.set", coordinatorOnly: true, strict: true } });
    const toPeer = await msg(ann, { body: "secret plan for bob", to: ["bob"] });
    const ms = [mode, toPeer];
    const s = fold(ms, roster);
    const person = agentRows(s, ms, "jonatas", new Set(), T0 + 120_000).find((r) => r.name === "ann")!;
    expect(person.statusLine).toBeUndefined();
    // An agent may see it (strict only hides it from people).
    expect(agentRows(s, ms, "coord", new Set(), T0 + 120_000).find((r) => r.name === "ann")!.statusLine?.text).toBe("secret plan for bob");
  });
});

describe("needs a person", () => {
  test("asks to people count; asks between agents don't; in coordinator-only, the coordinator's asks do", async () => {
    const toOwner = await msg(ann, { kind: "ask", body: "ship it?", to: ["jonatas"] });
    const toAgent = await msg(ann, { kind: "ask", body: "which port?", to: ["bob"] });
    const ms = [toOwner, toAgent];
    expect(needsPerson(fold(ms, roster), "jonatas").map((n) => n.text)).toEqual(["ship it?"]);

    const mode = await msg(owner, { ev: { op: "mode.set", coordinatorOnly: true, strict: true } });
    const viaCoord = await msg(coord, { kind: "blocking", body: "need your OK on the deploy" });
    const ms2 = [mode, viaCoord];
    expect(needsPerson(fold(ms2, roster), "jonatas")).toMatchObject([{ from: "coord", kind: "blocking", text: "need your OK on the deploy" }]);
  });
});

describe("a task's feed", () => {
  test("its own events, every thread that names it (whole, as one card), and the PRs linked there", async () => {
    const add = await msg(coord, { ev: { op: "task.add", title: "Work view", owner: "ann" } });
    const other = await msg(bob, { body: "unrelated" });
    const root = await msg(coord, { body: `Top priority: T${add.seq}.` });
    const reply = await msg(ann, { body: "On it.", re: [root.seq] });
    const note = await msg(ann, { ev: { op: "task.update", task: add.seq, state: "doing", note: "PR up: https://github.com/o/r/pull/49" } });
    const ms = [add, other, root, reply, note];
    const s = fold(ms, roster);
    const feed = taskFeed(s, ms, add.seq, "jonatas");
    expect(feed.map((i) => i.type)).toEqual(["event", "thread", "event", "pr"]);
    const thread = feed.find((i) => i.type === "thread")!;
    expect(thread.type === "thread" && thread.messages.map((m) => m.body)).toEqual([`Top priority: T${add.seq}.`, "On it."]);
    expect(taskPrs(feed).map((p) => p.number)).toEqual([49]);
    // Told from the task's page: no task id or title repeated, and a note reads as text.
    expect(feed.filter((i) => i.type === "event").map((i) => i.type === "event" && [i.text, i.mark, i.note])).toEqual([
      ["created the task for ann", "add", undefined],
      ["started it", "doing", "PR up: https://github.com/o/r/pull/49"],
    ]);
  });

  test("strict: a thread an agent kept between agents stays out of a person's task feed", async () => {
    const mode = await msg(owner, { ev: { op: "mode.set", coordinatorOnly: true, strict: true } });
    const add = await msg(coord, { ev: { op: "task.add", title: "Quiet", owner: "ann" } });
    const peer = await msg(ann, { body: `T${add.seq}: bob, take the CSS`, to: ["bob"] });
    const ms = [mode, add, peer];
    const s = fold(ms, roster);
    expect(taskFeed(s, ms, add.seq, "jonatas").some((i) => i.type === "thread")).toBe(false);
    expect(taskFeed(s, ms, add.seq, "coord").some((i) => i.type === "thread")).toBe(true);
  });
});
