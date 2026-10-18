import { beforeAll, describe, expect, test } from "bun:test";
import { wants } from "../src/agent.ts";
import { leadLine } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { needsPerson } from "@kiwi/core/work.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function msg(from: string, kind: Kind, body: string, extra: { to?: string[]; ev?: Event } = {}): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ...extra, ts: seq };
  const p = await sign(ids[from]!, base);
  return { ...p, seq, rts: seq, sigOk: await verify(p) };
}
const ev = (from: string, e: Event) => msg(from, "event", "", { ev: e });
const oldModeOn = () => ev("jon", { op: "mode.set", coordinatorOnly: true, strict: true });
const makeLead = (member: string, role = "lead") => ev("jon", { op: "role.set", member, role });

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "ana", "lead", "dev", "dev2"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ana", pk: ids.ana!.pk, owner: false, at: 1, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 3, active: true, kind: "agent", role: "frontend" },
    { name: "dev2", pk: ids.dev2!.pk, owner: false, at: 4, active: true, kind: "agent" },
  ];
});

describe("the lead", () => {
  test("one lead: giving the role to someone else moves it, clearing it leaves none", async () => {
    const ms = [await makeLead("lead"), await makeLead("dev2")];
    const s = fold(ms, roster);
    expect(s.lead).toBe("dev2");
    expect(s.members.get("lead")!.persona).toBeUndefined();
    expect(fold([ms[0]!], roster).lead).toBe("lead");
    expect(fold([ms[0]!, await ev("jon", { op: "role.set", member: "lead", role: null })], roster).lead).toBeNull();
  });

  test("an old coordinator role reads as the lead, from a record or a role.set", async () => {
    expect(fold([await makeLead("dev2", "coordinator")], roster)).toMatchObject({ lead: "dev2" });
    expect(fold([await makeLead("dev2", "coordinator")], roster).members.get("dev2")!.persona?.role).toBe("lead");
    const r = roster.map((x) => (x.name === "lead" || x.name === "dev2" ? { ...x, role: "Coordinator" } : x));
    const s = fold([], r);
    expect(s.lead).toBe("lead");
    expect(s.members.get("lead")!.persona?.role).toBe("lead");
    expect(s.members.get("dev2")!.persona).toBeUndefined();
  });

  test("no lead by default", () => {
    expect(fold([], roster).lead).toBeNull();
  });
});

describe("coordinator-only is gone", () => {
  test("an old mode.set folds to nothing: an agent's message to a person stands, and reaches them", async () => {
    const setup = [await makeLead("lead"), await oldModeOn()];
    const toPerson = await msg("dev", "msg", "ana: the login is fixed", { to: ["ana"] });
    const s = fold([...setup, toPerson], roster);
    expect(s.rejected.has(setup[1]!.seq)).toBe(false);
    expect(s.trust.get(toPerson.seq)).toBe("verified");
    expect(s.rejected.has(toPerson.seq)).toBe(false);
    expect(wants("ana", toPerson, s)).toBe(true);
  });

  test("a person's words reach every agent, not just the lead", async () => {
    const setup = [await makeLead("lead"), await oldModeOn()];
    const broadcast = await msg("ana", "msg", "can someone fix the login?");
    const s = fold([...setup, broadcast], roster);
    for (const n of ["lead", "dev", "dev2"]) expect(wants(n, broadcast, s)).toBe(true);
  });

  test("a lead's ask to an agent isn't a person's to answer", async () => {
    const setup = [await makeLead("lead"), await oldModeOn()];
    const ask = await msg("lead", "ask", "dev, can you take the login bug?", { to: ["dev"] });
    expect(needsPerson(fold([...setup, ask], roster))).toEqual([]);
  });
});

describe("what each member is told", () => {
  test("status names the lead, and tells the lead what it's for", async () => {
    const s = fold([await makeLead("lead")], roster);
    expect(leadLine(s, "lead")).toContain("you are the lead");
    expect(leadLine(s, "dev")).toContain("lead: lead");
    expect(leadLine(s, "dev")).toContain("Talk to people directly");
    expect(leadLine(fold([], roster), "dev")).toBeNull();
  });

  test("the prompt carries the lead line only when there is a lead", async () => {
    const { agentPrompt } = await import("../src/cli/brief.ts");
    const state = fold([await makeLead("lead")], roster);
    expect(agentPrompt("c", "dev", { lead: leadLine(state, "dev") })).toContain("lead: lead");
    expect(agentPrompt("c", "dev")).not.toContain("lead:");
  });
});
