import { beforeAll, describe, expect, test } from "bun:test";
import { newChannelKey } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { makeRecord, openRecord, readRecord, sealRecord } from "@kiwi/core/membership.ts";
import { personaOf, personaScopes } from "@kiwi/core/personality.ts";
import { PRESETS } from "@kiwi/core/presets.ts";
import { wellFormedEvent, type Event, type Message } from "@kiwi/core/protocol.ts";
import { wireScopes } from "@kiwi/core/scopes.ts";
import { fold, toRoster, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}

const lead = personaOf(PRESETS.find((p) => p.role === "lead")!);
const reviewer = personaOf(PRESETS.find((p) => p.role === "reviewer")!);

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jow", "mia", "bo", "gone", "bot", "pix"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mia", pk: ids.mia!.pk, owner: false, at: 1, active: true, kind: "human", managesAgents: true },
    { name: "bo", pk: ids.bo!.pk, owner: false, at: 2, active: true, kind: "human" },
    { name: "gone", pk: ids.gone!.pk, owner: false, at: 3, active: false, kind: "human", managesAgents: true },
    { name: "bot", pk: ids.bot!.pk, owner: false, at: 4, active: true, kind: "agent" },
    { name: "pix", pk: ids.pix!.pk, owner: false, at: 5, active: true, kind: "agent" },
  ];
});

describe("a person who manages agents (T443)", () => {
  test("picks an agent's role, the lead included, as the owner does", async () => {
    const ms = [await ev("mia", { op: "role.set", member: "bot", role: "lead" }), await ev("mia", { op: "role.set", member: "pix", role: "reviewer", about: "reads every PR" })];
    const s = fold(ms, roster);
    for (const m of ms) expect(s.rejected.has(m.seq)).toBe(false);
    expect(s.lead).toBe("bot");
    expect(s.roleSets.get("pix")).toEqual({ seq: ms[1]!.seq, role: "reviewer", about: "reads every PR" });
  });

  test("never on a person, the owner, their own seat, or as someone without the power", async () => {
    const ms = [
      await ev("mia", { op: "role.set", member: "bo", role: "lead" }),
      await ev("mia", { op: "role.set", member: "jow", role: "reviewer" }),
      await ev("mia", { op: "role.set", member: "mia", role: "lead" }),
      await ev("bo", { op: "role.set", member: "bot", role: "lead" }),
      await ev("bot", { op: "role.set", member: "pix", role: "lead" }),
      await ev("mia", { op: "scope.set", member: "bo", pk: ids.bo!.pk, scopes: [] }),
      await ev("mia", { op: "scope.set", member: "mia", pk: ids.mia!.pk, scopes: null }),
    ];
    const s = fold(ms, roster);
    for (const m of ms) expect([m.seq, s.rejected.has(m.seq)]).toEqual([m.seq, true]);
    expect(s.lead).toBeNull();
    expect(s.members.get("bo")?.scopes.length).toBeGreaterThan(0);
  });

  test("what they did while they held the power stands after it's taken away, or after they leave, folded whole or from a snapshot", async () => {
    const set = await ev("mia", { op: "role.set", member: "bot", role: "lead" });
    const took = await ev("jow", { op: "power.set", member: "mia", pk: ids.mia!.pk, power: "managesAgents", on: false, was: true });
    const late = await ev("mia", { op: "role.set", member: "pix", role: "lead" });
    const log = [set, took, late];
    const revoked = roster.map((r) => (r.name === "mia" ? { ...r, managesAgents: undefined } : r));
    const whole = fold(log, revoked);
    expect(whole.rejected.has(set.seq)).toBe(false);
    expect(whole.rejected.has(took.seq)).toBe(false);
    expect(whole.rejected.get(late.seq)).toBe("only the owner, or a person who manages agents, decides an agent's role");
    expect(whole.lead).toBe("bot");
    let base: FoldBase | null = null;
    fold([set], roster, Date.now(), null, null, null, (b) => void (base = b));
    const resumed = fold([took, late], revoked, Date.now(), null, null, base);
    expect([resumed.lead, resumed.rejected.has(late.seq)]).toEqual(["bot", true]);
    const left = roster.map((r) => (r.name === "mia" ? { ...r, active: false } : r));
    expect(fold([set], left).lead).toBe("bot");
  });

  test("a power given after joining counts from where it lands, and only the owner gives it, only to a person", async () => {
    const before = await ev("bo", { op: "role.set", member: "bot", role: "lead" });
    const gave = await ev("jow", { op: "power.set", member: "bo", pk: ids.bo!.pk, power: "managesAgents", on: true, was: false });
    const after = await ev("bo", { op: "role.set", member: "pix", role: "reviewer" });
    const self = await ev("mia", { op: "power.set", member: "bo", pk: ids.bo!.pk, power: "managesAgents", on: true, was: false });
    const agent = await ev("jow", { op: "power.set", member: "bot", pk: ids.bot!.pk, power: "managesAgents", on: true, was: false });
    const granted = roster.map((r) => (r.name === "bo" ? { ...r, managesAgents: true } : r));
    const s = fold([before, gave, after, self, agent], granted);
    expect(s.rejected.has(before.seq)).toBe(true);
    expect(s.rejected.has(after.seq)).toBe(false);
    expect(s.rejected.get(self.seq)).toBe("only the owner gives or takes a power");
    expect(s.rejected.get(agent.seq)).toBe("only a person holds a power");
  });

  test("gives an agent a personality: what it may do and whether it leads change at once, and the owner's app re-signs the rest", async () => {
    const scopes = wireScopes(personaScopes(reviewer));
    const ms = [await ev("mia", { op: "scope.set", member: "pix", pk: ids.pix!.pk, scopes, lead: false, wasLead: false, persona: reviewer })];
    const s = fold(ms, roster);
    expect(s.rejected.has(ms[0]!.seq)).toBe(false);
    expect(s.members.get("pix")?.scopes).toEqual(personaScopes(reviewer));
    expect(s.scopeSets.get(ids.pix!.pk)).toEqual({ seq: ms[0]!.seq, scopes: personaScopes(reviewer), persona: reviewer });

    const made = [await ev("mia", { op: "scope.set", member: "bot", pk: ids.bot!.pk, scopes: wireScopes(personaScopes(lead)), lead: true, wasLead: false, persona: lead })];
    const signed = roster.map((r) => (r.name === "bot" ? { ...r, persona: lead } : r));
    expect(fold(made, signed).lead).toBe("bot");

    const cleared = [await ev("mia", { op: "scope.set", member: "pix", pk: ids.pix!.pk, scopes: null, lead: false, wasLead: false, persona: null })];
    expect(fold(cleared, roster).scopeSets.get(ids.pix!.pk)?.persona).toBeNull();
  });

  test("a personality on a scope.set has to be one a record could carry", () => {
    const base = { op: "scope.set", member: "pix", pk: "k", scopes: null };
    expect(wellFormedEvent({ ...base, persona: reviewer })).toBe(true);
    expect(wellFormedEvent({ ...base, persona: null })).toBe(true);
    expect(wellFormedEvent({ ...base, persona: { name: "" } })).toBe(false);
  });
});

describe("the power on a person's record (T443)", () => {
  test("only the owner signs it in, and only onto a person", async () => {
    const owner = await generateIdentity("owner");
    const ana = await generateIdentity("ana");
    const key = newChannelKey();
    const room = "ab".repeat(16);
    const rec = await makeRecord(owner, room, { name: "ana", pk: ana.pk, xpk: ana.xpk!, kind: "human", managesAgents: true });
    const opened = await openRecord(key, await sealRecord(key, rec), room, owner.pk, ana.pk);
    expect(opened?.managesAgents).toBe(true);
    expect(fold([], [toRoster({ ...opened!, owner: false })]).members.get("ana")?.managesAgents).toBe(true);

    const agent = await makeRecord(owner, room, { name: "bot", pk: ana.pk, xpk: ana.xpk!, kind: "agent", managesAgents: true });
    expect((agent as { managesAgents?: unknown }).managesAgents).toBeUndefined();

    const forged = await sign(ana, { ...rec, pk: undefined, sig: undefined });
    const read = await readRecord(key, await sealRecord(key, forged as unknown as Parameters<typeof sealRecord>[1]), room, ana.pk, owner.pk);
    expect(read?.member.managesAgents).toBeUndefined();
  });
});
