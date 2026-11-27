import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { dutyLines } from "../src/cli/commands/lead.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
const T0 = 1_000_000;
async function ev(from: string, e: Event): Promise<Message> {
  const n = ++seq;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: T0 + n };
  const p = await sign(ids[from]!, base);
  return { ...p, seq: n, rts: T0 + n, sigOk: await verify(p) };
}

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ana", "bo", "lead", "spare", "dev"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "human" },
    { name: "bo", pk: ids.bo!.pk, owner: false, at: 2, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 3, active: true, kind: "agent" },
    { name: "spare", pk: ids.spare!.pk, owner: false, at: 4, active: true, kind: "agent" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 5, active: true, kind: "agent" },
  ];
});

const now = () => T0 + seq + 1000;
const trust = async (member: string) =>
  Promise.all((["addsAgents", "answersDecisions", "managesAgents"] as const).map((power) => ev("jon", { op: "power.set", member, pk: ids[member]!.pk, power, on: true, was: false })));

async function channel(): Promise<Message[]> {
  return [await ev("jon", { op: "role.set", member: "lead", role: "lead" }), ...(await trust("ana")), await ev("jon", { op: "lead.standby", name: "spare", on: true })];
}

function baseOf(messages: Message[]): FoldBase {
  let base: FoldBase | null = null;
  fold(messages, roster, now(), null, null, null, (b) => void (base = b));
  if (!base) throw new Error("no base");
  return base;
}

const rejected = (log: Message[], m: Message) => fold(log, roster, now()).rejected.get(m.seq);

describe("standby approval", () => {
  test("the owner or a trusted person approves and withdraws a standby; an agent or an untrusted person can't", async () => {
    const log = await channel();
    expect([...fold(log, roster, now()).standbys.keys()]).toEqual(["spare"]);
    const byAna = await ev("ana", { op: "lead.standby", name: "dev", on: true });
    const byBo = await ev("bo", { op: "lead.standby", name: "dev", on: false });
    const byLead = await ev("lead", { op: "lead.standby", name: "spare", on: false });
    const s = fold([...log, byAna, byBo, byLead], roster, now());
    expect([...s.standbys.keys()].sort()).toEqual(["dev", "spare"]);
    expect(s.rejected.get(byBo.seq)).toContain("only the owner or a person the owner trusts");
    expect(s.rejected.get(byLead.seq)).toContain("only the owner or a person the owner trusts");
    const off = await ev("jon", { op: "lead.standby", name: "dev", on: false });
    expect([...fold([...log, byAna, off], roster, now()).standbys.keys()]).toEqual(["spare"]);
  });

  test("a handover to a seat that isn't an approved standby is refused; withdrawing the seat on duty doesn't move the duty", async () => {
    const log = await channel();
    const toDev = await ev("lead", { op: "lead.duty", to: "dev", from: 0 });
    expect(rejected([...log, toDev], toDev)).toBe("dev isn't an approved standby lead");
    const toSpare = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const withdraw = await ev("jon", { op: "lead.standby", name: "spare", on: false });
    const s = fold([...log, toSpare, withdraw], roster, now());
    expect(s.lead).toBe("spare");
    expect(s.standbys.has("spare")).toBe(false);
  });
});

describe("one lead on duty", () => {
  test("before any handover the channel behaves as today: its own lead is the lead, with no duty", async () => {
    const s = fold(await channel(), roster, now());
    expect(s.lead).toBe("lead");
    expect(s.homeLead).toBe("lead");
    expect(s.duty).toBeNull();
  });

  test("after a handover the standby is the lead everywhere, and only it or a person keeps lead powers", async () => {
    const log = await channel();
    const task = await ev("dev", { op: "task.add", title: "ship it" });
    const hand = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const staleDelete = await ev("lead", { op: "task.delete", task: task.seq });
    const s = fold([...log, task, hand, staleDelete], roster, now());
    expect(s.lead).toBe("spare");
    expect(s.homeLead).toBe("lead");
    expect(s.duty).toEqual({ lead: "spare", since: hand.seq, by: "lead" });
    expect(s.rejected.get(staleDelete.seq)).toContain("only a person or the lead deletes");
    const onDutyDelete = await ev("spare", { op: "task.delete", task: task.seq });
    expect(fold([...log, task, hand, onDutyDelete], roster, now()).rejected.has(onDutyDelete.seq)).toBe(false);
    expect(dutyLines(s)).toEqual([`lead on duty: spare (the channel's own lead: lead)`, `assignment: #${hand.seq}, by lead`, "standby leads: spare"]);
  });

  test("only the lead on duty, the owner or a trusted person hands over; the return to the channel's own lead needs no approval", async () => {
    const log = await channel();
    const byDev = await ev("dev", { op: "lead.duty", to: "spare", from: 0 });
    const byBo = await ev("bo", { op: "lead.duty", to: "spare", from: 0 });
    expect(rejected([...log, byDev], byDev)).toContain("only the lead on duty, the owner or a person the owner trusts");
    expect(rejected([...log, byBo], byBo)).toContain("only the lead on duty, the owner or a person the owner trusts");
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const back = await ev("spare", { op: "lead.duty", to: "lead", from: out.seq });
    const s = fold([...log, out, back], roster, now());
    expect(s.rejected.has(back.seq)).toBe(false);
    expect(s.lead).toBe("lead");
    expect(s.duty).toEqual({ lead: "lead", since: back.seq, by: "spare" });
    const byAna = await ev("ana", { op: "lead.duty", to: "spare", from: back.seq });
    expect(fold([...log, out, back, byAna], roster, now()).lead).toBe("spare");
  });
});

describe("one authoritative order", () => {
  test("two handovers from the same assignment, both by the owner: the first in the log wins", async () => {
    const log = await channel();
    const first = await ev("jon", { op: "lead.duty", to: "spare", from: 0 });
    const second = await ev("jon", { op: "lead.duty", to: "lead", from: 0 });
    const s = fold([...log, first, second], roster, now());
    expect(s.lead).toBe("spare");
    expect(s.rejected.get(second.seq)).toContain("the lead on duty changed since you looked");
  });

  test("an old request arriving after A → B → A is refused; a fresh override by the owner works", async () => {
    const log = await channel();
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const back = await ev("spare", { op: "lead.duty", to: "lead", from: out.seq });
    const old = await ev("jon", { op: "lead.duty", to: "spare", from: 0 });
    const fresh = await ev("jon", { op: "lead.duty", to: "spare", from: back.seq });
    const s = fold([...log, out, back, old, fresh], roster, now());
    expect(s.rejected.get(old.seq)).toContain("the lead on duty changed since you looked");
    expect(s.rejected.has(fresh.seq)).toBe(false);
    expect(s.duty).toEqual({ lead: "spare", since: fresh.seq, by: "jon" });
  });

  test("a stale lead command after the handover is refused, and a snapshot plus resume agrees with a full replay", async () => {
    const log = await channel();
    const task = await ev("dev", { op: "task.add", title: "ship it" });
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const staleHand = await ev("lead", { op: "lead.duty", to: "dev", from: out.seq });
    const staleDelete = await ev("lead", { op: "task.delete", task: task.seq });
    const all = [...log, task, out, staleHand, staleDelete];
    const full = fold(all, roster, now());
    expect(full.rejected.get(staleHand.seq)).toContain("only the lead on duty");
    expect(full.rejected.get(staleDelete.seq)).toContain("only a person or the lead deletes");
    for (let cut = 1; cut < all.length; cut++) {
      const resumed = fold(all.slice(cut), roster, now(), null, null, baseOf(all.slice(0, cut)));
      expect({ cut, lead: resumed.lead, home: resumed.homeLead, duty: resumed.duty, standbys: [...resumed.standbys.keys()] }).toEqual({
        cut,
        lead: full.lead,
        home: full.homeLead,
        duty: full.duty,
        standbys: [...full.standbys.keys()],
      });
    }
  });
});

describe("assignment follows the duty", () => {
  test("after a handover the former lead can't give a task to someone else; the standby and a person can, and a self-claim still works", async () => {
    const log = await channel();
    const task = await ev("dev", { op: "task.add", title: "ship it" });
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const byFormer = await ev("lead", { op: "task.update", task: task.seq, owner: "dev" });
    const byStandby = await ev("spare", { op: "task.update", task: task.seq, owner: "dev" });
    const byPerson = await ev("bo", { op: "task.update", task: task.seq, owner: "dev" });
    const selfClaim = await ev("dev", { op: "task.update", task: task.seq, owner: "dev" });
    const addFor = await ev("lead", { op: "task.add", title: "for dev", owner: "dev" });
    const s = fold([...log, task, out, byFormer, addFor], roster, now());
    expect(s.rejected.get(byFormer.seq)).toBe("only the lead on duty or a person gives a task to dev");
    expect(s.rejected.get(addFor.seq)).toBe("only the lead on duty or a person gives a task to dev");
    for (const ok of [byStandby, byPerson, selfClaim]) expect(fold([...log, task, out, ok], roster, now()).tasks.get(task.seq)?.owner).toBe("dev");
  });

  test("with no handover, assignment works as it does today", async () => {
    const log = await channel();
    const task = await ev("dev", { op: "task.add", title: "ship it" });
    const byAgent = await ev("spare", { op: "task.update", task: task.seq, owner: "dev" });
    expect(fold([...log, task, byAgent], roster, now()).tasks.get(task.seq)?.owner).toBe("dev");
  });
});
