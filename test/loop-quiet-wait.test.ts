import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { waitingFor, wants } from "../src/agent/wants.ts";

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
    const before = fold([add, sent], roster);
    const waiting = waitingFor(before, "win");
    expect(waiting).toEqual({ waiting: t });

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
    const state = fold([add, sent, ...Object.values(quiet), ...Object.values(loud)], roster);
    for (const [name, m] of Object.entries(quiet)) expect([name, wants("win", m, state, waiting)]).toEqual([name, false]);
    for (const [name, m] of Object.entries(loud)) expect([name, wants("win", m, state, waiting)]).toEqual([name, true]);
    expect(wants("win", quiet.chatter, state)).toBe(true);
  });

  test("only a task the seat owns, with a round open and someone else reviewing, makes it wait", async () => {
    const add = await ev("jon", { op: "task.add", title: "ship it", owner: "win", review: "mac" });
    expect(waitingFor(fold([add], roster), "win")).toEqual({});
    const sent = await ev("win", { op: "task.update", task: add.seq, state: "review", at: "abc1234" });
    expect(waitingFor(fold([add, sent], roster), "mac")).toEqual({});
    const own = await ev("jon", { op: "task.add", title: "self", owner: "linux", review: "linux" });
    const round = await ev("linux", { op: "task.update", task: own.seq, state: "review", at: "abc1234" });
    expect(waitingFor(fold([own, round], roster), "linux")).toEqual({});
  });
});
