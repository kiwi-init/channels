import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { waitingTask, wants } from "../src/agent/wants.ts";

const loop = { loop: true } as const;

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, extra: { to?: string[]; ev?: Event } = {}): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const ev = (from: string, e: Event, to?: string[]) => msg(from, "event", "", { ev: e, ...(to ? { to } : {}) });

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "mac", "win", "linux"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "linux", pk: ids.linux!.pk, owner: false, at: 3, active: true, kind: "agent" },
  ];
});

describe("a loop session waiting for its verdict (#1117)", () => {
  test("is woken by what changes its work, not by the channel going on around it", async () => {
    const add = await ev("jon", { op: "task.add", title: "ship it", owner: "win", review: "mac" });
    const t = add.seq;
    const sent = await ev("win", { op: "task.update", task: t, state: "review", at: "abc1234" });
    expect(waitingTask(fold([add, sent], roster), "win")).toBe(t);

    const quiet = {
      join: await ev("linux", { op: "hello", about: "new here" }),
      everyone: await msg("jon", "msg", "standup in 5", { to: ["*"] }),
      chatter: await msg("jon", "msg", "anyone seen the build?"),
      otherTask: await ev("jon", { op: "task.add", title: "next thing", owner: "win" }, ["win"]),
    };
    const loud = {
      verdict: await ev("mac", { op: "task.update", task: t, state: "done", verdict: "approved", round: 1 }),
      direct: await msg("jon", "msg", "how is it going?", { to: ["win"] }),
      mention: await msg("jon", "msg", "@win can you check the logs?"),
      hold: await ev("jon", { op: "hold.set", on: true }),
    };
    const state = fold([add, sent, ...Object.values(quiet), ...Object.values(loud).filter((m) => m !== loud.verdict)], roster);
    expect(waitingTask(state, "win")).toBe(t);
    for (const [name, m] of Object.entries(quiet)) expect([name, wants("win", m, state, loop)]).toEqual([name, false]);
    for (const [name, m] of Object.entries(loud)) expect([name, wants("win", m, state, loop)]).toEqual([name, true]);
    expect(wants("win", quiet.chatter, state)).toBe(true);
  });

  test("only a task the seat owns, with a round open and someone else reviewing, makes it wait", async () => {
    const add = await ev("jon", { op: "task.add", title: "ship it", owner: "win", review: "mac" });
    expect(waitingTask(fold([add], roster), "win")).toBeUndefined();
    const sent = await ev("win", { op: "task.update", task: add.seq, state: "review", at: "abc1234" });
    expect(waitingTask(fold([add, sent], roster), "mac")).toBeUndefined();
    const own = await ev("jon", { op: "task.add", title: "self", owner: "linux", review: "linux" });
    const round = await ev("linux", { op: "task.update", task: own.seq, state: "review", at: "abc1234" });
    expect(waitingTask(fold([own, round], roster), "linux")).toBeUndefined();
  });

  test("the same loop delivery follows the task: open while coding, quiet while a round is open, open again after the verdict", async () => {
    const add = await ev("jon", { op: "task.add", title: "ship it", owner: "win", review: "mac" });
    const chatter = await msg("jon", "msg", "anyone seen the build?");
    const sent = await ev("win", { op: "task.update", task: add.seq, state: "review", at: "abc1234" });
    const reject = await ev("mac", { op: "task.update", task: add.seq, state: "doing", verdict: "rejected", round: 1 });
    expect(wants("win", chatter, fold([add, chatter], roster), loop)).toBe(true);
    expect(wants("win", chatter, fold([add, chatter, sent], roster), loop)).toBe(false);
    expect(wants("win", chatter, fold([add, chatter, sent, reject], roster), loop)).toBe(true);
  });

  test("the event that ends the wait still reaches the seat, even when it isn't addressed to it", async () => {
    const add = await ev("jon", { op: "task.add", title: "ship it", owner: "win", review: "mac" });
    const sent = await ev("win", { op: "task.update", task: add.seq, state: "review", at: "abc1234" });
    const moved = await ev("jon", { op: "task.update", task: add.seq, owner: "linux" }, ["linux"]);
    const verdict = await ev("mac", { op: "task.update", task: add.seq, state: "doing", verdict: "rejected", round: 1 });
    expect(wants("win", moved, fold([add, sent, moved], roster), loop)).toBe(true);
    expect(wants("win", verdict, fold([add, sent, verdict], roster), loop)).toBe(true);
  });

  test("an update to a task the seat handed on doesn't reach it, waiting or not", async () => {
    const old = await ev("jon", { op: "task.add", title: "old", owner: "win", review: "linux" });
    const handed = await ev("win", { op: "task.update", task: old.seq, owner: "mac" }, ["mac"]);
    const theirs = await ev("mac", { op: "task.update", task: old.seq, state: "review", at: "def5678" });
    const note = await ev("jon", { op: "task.update", task: old.seq, note: "mac: rebase first" }, ["mac"]);
    const add = await ev("jon", { op: "task.add", title: "ship it", owner: "win", review: "mac" });
    expect(wants("win", note, fold([old, handed, theirs, add, note], roster), loop)).toBe(false);
    const sent = await ev("win", { op: "task.update", task: add.seq, state: "review", at: "abc1234" });
    expect(wants("win", note, fold([old, handed, theirs, add, sent, note], roster), loop)).toBe(false);
  });

  test("once its open round is handed on, the seat hears the handoff and nothing after it", async () => {
    const t14 = await ev("jon", { op: "task.add", title: "t14", owner: "win", review: "linux" });
    const sent = await ev("win", { op: "task.update", task: t14.seq, state: "review", at: "abc1234" });
    const moved = await ev("jon", { op: "task.update", task: t14.seq, owner: "mac" }, ["mac"]);
    const note = await ev("jon", { op: "task.update", task: t14.seq, note: "mac: rebase first" }, ["mac"]);
    expect(wants("win", moved, fold([t14, sent, moved], roster), loop)).toBe(true);
    expect(wants("win", note, fold([t14, sent, moved, note], roster), loop)).toBe(false);
    const add = await ev("jon", { op: "task.add", title: "ship it", owner: "win", review: "mac" });
    const mine = await ev("win", { op: "task.update", task: add.seq, state: "review", at: "abc1234" });
    expect(wants("win", note, fold([t14, sent, moved, add, mine, note], roster), loop)).toBe(false);
  });

  test("only the update that takes the task from the seat reaches it: not a repeat, and whoever sent the round", async () => {
    const add = await ev("jon", { op: "task.add", title: "ship it", owner: "win", review: "linux" });
    const sent = await ev("win", { op: "task.update", task: add.seq, state: "review", at: "abc1234" });
    const moved = await ev("jon", { op: "task.update", task: add.seq, owner: "mac" }, ["mac"]);
    const again = await ev("jon", { op: "task.update", task: add.seq, owner: "mac", note: "mac: it's yours" }, ["mac"]);
    expect(wants("win", again, fold([add, sent, moved, again], roster), loop)).toBe(false);

    const back = await ev("jon", { op: "task.add", title: "back", owner: "mac", review: "linux" });
    const toWin = await ev("jon", { op: "task.update", task: back.seq, owner: "win" }, ["win"]);
    const winSent = await ev("win", { op: "task.update", task: back.seq, state: "review", at: "abc1234" });
    const toMac = await ev("jon", { op: "task.update", task: back.seq, owner: "mac" }, ["mac"]);
    expect(wants("win", toMac, fold([back, toWin, winSent, toMac], roster), loop)).toBe(true);

    const cleared = await ev("jon", { op: "task.update", task: add.seq, owner: null });
    expect(wants("win", cleared, fold([add, sent, cleared], roster), loop)).toBe(true);

    const proxy = await ev("jon", { op: "task.update", task: add.seq, state: "review", at: "abc1234" });
    const away = await ev("jon", { op: "task.update", task: add.seq, owner: "linux" }, ["linux"]);
    expect(wants("win", away, fold([add, proxy, away], roster), loop)).toBe(true);
  });
});
