import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { taskDigest } from "@kiwi/core/work.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, extra: { ev?: Event; re?: number[] } = {}): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const ev = (from: string, e: Event) => msg(from, "event", "", { ev: e });

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "mac", "win"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
  ];
});

describe("a closed task's digest", () => {
  test("outcome, last note besides the approval, its PRs once each, who worked it, who approved, how much was said", async () => {
    const add = await ev("jon", { op: "task.add", title: "Ship the digest", owner: "mac", review: "jon" });
    const t = add.seq;
    const log = [
      add,
      await ev("mac", { op: "task.update", task: t, state: "doing", note: "PR https://github.com/ojow/channels/pull/12" }),
      await msg("mac", "msg", `T${t}: halfway, see https://github.com/ojow/channels/pull/12`),
      await ev("win", { op: "task.update", task: t, note: "and https://github.com/ojow/channels/pull/13" }),
      await ev("mac", { op: "task.update", task: t, state: "review", note: "ready" }),
      await ev("jon", { op: "task.update", task: t, state: "done", verdict: "approved", note: "approved", round: 1 }),
    ];
    const s = fold(log, roster);
    expect(taskDigest(s, log, s.tasks.get(t)!)).toBe(`T${t} done: Ship the digest · ready · PR ojow/channels#12, ojow/channels#13 · by mac · approved by jon · 1 message in its threads`);
  });

  test("a cancelled one says why, and no approval", async () => {
    const add = await ev("jon", { op: "task.add", title: "Old idea", owner: "mac" });
    const log = [add, await ev("jon", { op: "task.update", task: add.seq, state: "cancelled", note: "superseded by T9" })];
    const s = fold(log, roster);
    expect(taskDigest(s, log, s.tasks.get(add.seq)!)).toBe(`T${add.seq} cancelled: Old idea · superseded by T9 · by mac`);
  });
});
