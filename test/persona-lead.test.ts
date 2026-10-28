import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Persona } from "@kiwi/core/personality.ts";
import { wellFormed, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event, late = 0): Promise<Message> {
  seq++;
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e });
  return { ...p, seq, rts: seq + late, sigOk: await verify(p) };
}

const LEAD: Persona = { name: "Lead", role: "lead", capabilities: [], areas: [], instructions: "" };
let before: Roster;
let after: Roster;
beforeAll(async () => {
  for (const n of ["jon", "mac", "win", "linux"]) ids[n] = await generateIdentity(n);
  before = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent" },
    { name: "win", pk: ids.win!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "linux", pk: ids.linux!.pk, owner: false, at: 3, active: true, kind: "agent" },
  ];
  after = before.map((r) => (r.name === "linux" ? { ...r, persona: LEAD } : r));
});

const promote = (to: boolean, was: boolean): Event => ({ op: "scope.set", member: "linux", pk: ids.linux!.pk, scopes: null, lead: to, wasLead: was });

describe("lead by persona follows the log (#1122)", () => {
  test("a change before the promotion is refused, after it accepted, for a kept base and a full fold alike", async () => {
    const add = await ev("jon", { op: "task.add", title: "stalled", owner: "win", review: "mac" });
    const early = await ev("linux", { op: "task.update", task: add.seq, review: "linux" });
    const made = await ev("jon", promote(true, false));
    const late = await ev("linux", { op: "task.update", task: add.seq, review: "linux" });
    const kept: { base?: FoldBase } = {};
    fold([add, early], before, Date.now(), null, null, null, (b) => void (kept.base = b));
    const resumed = fold([made, late], after, Date.now(), null, null, kept.base);
    const full = fold([add, early, made, late], after);
    for (const s of [resumed, full]) {
      expect(s.rejected.has(early.seq)).toBe(true);
      expect(s.rejected.has(late.seq)).toBe(false);
      expect(s.tasks.get(add.seq)!.review).toBe("linux");
    }
  });

  test("a demotion keeps the lead's earlier changes, for a kept base and a full fold alike", async () => {
    const add = await ev("jon", { op: "task.add", title: "stalled", owner: "win", review: "mac" });
    const other = await ev("jon", { op: "task.add", title: "next", owner: "win", review: "mac" });
    const moved = await ev("linux", { op: "task.update", task: add.seq, review: "linux" });
    const dropped = await ev("jon", promote(false, true));
    const again = await ev("linux", { op: "task.update", task: other.seq, review: "linux" });
    const kept: { base?: FoldBase } = {};
    fold([add, other, moved], after, Date.now(), null, null, null, (b) => void (kept.base = b));
    const resumed = fold([dropped, again], before, Date.now(), null, null, kept.base);
    const full = fold([add, other, moved, dropped, again], before);
    for (const s of [resumed, full]) {
      expect(s.rejected.has(moved.seq)).toBe(false);
      expect(s.rejected.has(again.seq)).toBe(true);
      expect(s.tasks.get(add.seq)!.review).toBe("linux");
      expect(s.tasks.get(other.seq)!.review).toBe("mac");
    }
  });

  test("a change the fold refuses never seeds lead status, for a kept base and a full fold alike", async () => {
    const add = await ev("jon", { op: "task.add", title: "stalled", owner: "win", review: "mac" });
    const move = await ev("linux", { op: "task.update", task: add.seq, review: "linux" });
    const stale = await ev("jon", promote(false, true), 2 * 86_400_000);
    const kept: { base?: FoldBase } = {};
    fold([add, move], before, Date.now(), null, null, null, (b) => void (kept.base = b));
    const resumed = fold([stale], before, Date.now(), null, null, kept.base);
    const full = fold([add, move, stale], before);
    for (const s of [resumed, full]) {
      expect(s.rejected.has(stale.seq)).toBe(true);
      expect(s.rejected.has(move.seq)).toBe(true);
      expect(s.tasks.get(add.seq)!.review).toBe("mac");
    }
  });

  test("a persona change from an older client, without the fields, hands the member back to the roster", async () => {
    const made = await ev("jon", promote(true, false));
    const legacy = await ev("jon", { op: "scope.set", member: "linux", pk: ids.linux!.pk, scopes: null });
    const add = await ev("jon", { op: "task.add", title: "stalled", owner: "win", review: "mac" });
    const move = await ev("linux", { op: "task.update", task: add.seq, review: "linux" });
    const s = fold([made, legacy, add, move], before);
    expect(s.rejected.has(move.seq)).toBe(true);
    expect(s.tasks.get(add.seq)!.review).toBe("mac");
  });

  test("a persona change carries both values or neither", () => {
    const base = { op: "scope.set", member: "linux", pk: "k", scopes: null };
    const msg = (e: object) => ({ v: 1, id: "x", from: "jon", kind: "event", body: "", ts: 1, ev: e });
    expect(wellFormed(msg(base))).toBe(true);
    expect(wellFormed(msg({ ...base, lead: true, wasLead: false }))).toBe(true);
    expect(wellFormed(msg({ ...base, lead: true }))).toBe(false);
    expect(wellFormed(msg({ ...base, lead: "yes", wasLead: false }))).toBe(false);
  });
});
