import { beforeAll, describe, expect, test } from "bun:test";
import { wants } from "../src/agent.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts";
import { baseFromWire, toWire } from "@kiwi/core/base-wire.ts";
import { fold, handedOver, handedTo, handedToLead, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
const T0 = 1_000_000;
async function say(from: string, kind: Kind, body: string, extra: Partial<Pick<Message, "to" | "re" | "esc" | "ev">> = {}): Promise<Message> {
  const n = ++seq;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind, body, ts: T0 + n, ...extra };
  const p = await sign(ids[from]!, base);
  return { ...p, seq: n, rts: T0 + n, sigOk: await verify(p) };
}
const ev = (from: string, e: Event) => say(from, "event", "", { ev: e });

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jon", "bo", "lead", "spare", "dev"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "bo", pk: ids.bo!.pk, owner: false, at: 1, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "spare", pk: ids.spare!.pk, owner: false, at: 3, active: true, kind: "agent" },
    { name: "dev", pk: ids.dev!.pk, owner: false, at: 4, active: true, kind: "agent" },
  ];
});

const now = () => T0 + seq + 1000;
const at = (log: Message[]): ChannelState => fold(log, roster, now());
const open = (s: ChannelState, ask: Message) => s.openAsks.some((a) => a.seq === ask.seq);

async function channel(): Promise<Message[]> {
  return [await ev("jon", { op: "role.set", member: "lead", role: "lead" }), await ev("jon", { op: "lead.standby", name: "spare", on: true })];
}

const handed = (question: string) => say("dev", "blocking", handedOver("dev", question, {}), { to: ["lead"] });

function resumedAt(log: Message[], cut: number): ChannelState {
  let base: FoldBase | null = null;
  fold(log.slice(0, cut), roster, now(), null, null, null, (b) => void (base = b));
  if (!base) throw new Error("no base");
  return fold(log.slice(cut), roster, now(), null, null, base);
}

describe("a decision handed to the Lead follows the duty", () => {
  test("after a handover it is the standby's one card, the former lead has none, and a snapshot agrees", async () => {
    const setup = await channel();
    const ask = await handed("Which database?");
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const log = [...setup, ask, out];
    const s = at(log);
    expect(handedToLead(s, ask.seq)?.seq).toBe(ask.seq);
    expect(handedTo(s, "spare").map((h) => h.ask.seq)).toEqual([ask.seq]);
    expect(handedTo(s, "lead")).toEqual([]);
    for (let cut = 1; cut < log.length; cut++) {
      const r = resumedAt(log, cut);
      expect({ cut, mine: handedTo(r, "spare").map((h) => h.ask.seq), former: handedTo(r, "lead").length }).toEqual({ cut, mine: [ask.seq], former: 0 });
    }
  });

  test("the standby's answer is accepted once; the former lead's later reply is not an answer; author and answerer stay", async () => {
    const setup = await channel();
    const ask = await handed("Which database?");
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const stale = await say("lead", "msg", "postgres", { re: [ask.seq], to: ["dev"] });
    const pending = at([...setup, ask, out, stale]);
    expect(open(pending, ask)).toBe(true);
    const answer = await say("spare", "msg", "sqlite", { re: [ask.seq], to: ["dev"] });
    const again = await say("spare", "msg", "on second thought, postgres", { re: [ask.seq], to: ["dev"] });
    const log = [...setup, ask, out, stale, answer, again];
    const s = at(log);
    expect(open(s, ask)).toBe(false);
    expect(s.leadAsks.get(ask.seq)?.answer).toEqual({ by: "spare", seq: answer.seq });
    expect(s.leadAsks.get(ask.seq)?.from).toBe("dev");
    for (let cut = 1; cut < log.length; cut++) expect({ cut, open: open(resumedAt(log, cut), ask) }).toEqual({ cut, open: false });
  });

  test("an answer that races the handover counts for whoever was entitled at its place in the log", async () => {
    const setup = await channel();
    const ask = await handed("Which database?");
    const early = await say("lead", "msg", "postgres", { re: [ask.seq], to: ["dev"] });
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const late = await say("spare", "msg", "sqlite", { re: [ask.seq], to: ["dev"] });
    const s = at([...setup, ask, early, out, late]);
    expect(open(s, ask)).toBe(false);
    expect(s.leadAsks.get(ask.seq)?.answer).toEqual({ by: "lead", seq: early.seq });
    const person = await say("jon", "msg", "postgres", { re: [ask.seq], to: ["dev"] });
    const byPerson = at([...setup, ask, out, person]);
    expect(byPerson.leadAsks.get(ask.seq)?.answer).toEqual({ by: "jon", seq: person.seq });
  });

  test("on a round trip the card comes back to the channel's own lead, still once", async () => {
    const setup = await channel();
    const ask = await handed("Which database?");
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const back = await ev("spare", { op: "lead.duty", to: "lead", from: out.seq });
    const s = at([...setup, ask, out, back]);
    expect(handedTo(s, "lead").map((h) => h.ask.seq)).toEqual([ask.seq]);
    expect(handedTo(s, "spare")).toEqual([]);
    const answer = await say("lead", "msg", "postgres", { re: [ask.seq], to: ["dev"] });
    expect(open(at([...setup, ask, out, back, answer]), ask)).toBe(false);
  });
});

describe("an ask the lead put to a person follows the duty", () => {
  test("the answer is delivered once, to whoever was on duty when it came, on every seat, after a restore and after later transfers", async () => {
    const setup = await channel();
    const ask = await say("lead", "ask", "Ship 2.0 today?", { to: ["jon"], esc: true });
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const answer = await say("jon", "msg", "yes", { re: [ask.seq], to: ["lead"] });
    const log = [...setup, ask, out, answer];
    const s = at(log);
    expect(open(s, ask)).toBe(false);
    expect(s.leadOwned.get(ask.seq)).toEqual({ author: "lead", to: ["jon"], esc: true, plain: true, answer: { by: "jon", seq: answer.seq, to: "spare" } });
    const seats = (state: ChannelState) => ({ spare: wants("spare", answer, state), lead: wants("lead", answer, state), dev: wants("dev", answer, state) });
    expect(seats(s)).toEqual({ spare: true, lead: false, dev: false });
    for (let cut = 1; cut < log.length; cut++) expect({ cut, ...seats(resumedAt(log, cut)) }).toEqual({ cut, spare: true, lead: false, dev: false });
    const back = await ev("spare", { op: "lead.duty", to: "lead", from: out.seq });
    expect(seats(at([...log, back]))).toEqual({ spare: true, lead: false, dev: false });
    const out2 = await ev("lead", { op: "lead.duty", to: "spare", from: back.seq });
    const back2 = await ev("spare", { op: "lead.duty", to: "lead", from: out2.seq });
    const late = [...log, back, out2, back2];
    expect(seats(at(late))).toEqual({ spare: true, lead: false, dev: false });
    for (let cut = 1; cut < late.length; cut++) expect({ cut, ...seats(resumedAt(late, cut)) }).toEqual({ cut, spare: true, lead: false, dev: false });
    const later = await say("lead", "ask", "And 2.1?", { to: ["jon"], esc: true });
    const reply = await say("jon", "msg", "next week", { re: [later.seq], to: ["lead"] });
    const round = at([...late, later, reply]);
    expect(wants("lead", reply, round)).toBe(true);
    expect(wants("spare", reply, round)).toBe(false);
  });

  test("an answer that races the handover goes to the lead who was on duty then, and a second reply settles nothing", async () => {
    const setup = await channel();
    const ask = await say("lead", "ask", "Ship 2.0 today?", { to: ["jon"], esc: true });
    const answer = await say("jon", "msg", "yes", { re: [ask.seq], to: ["lead"] });
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const second = await say("jon", "msg", "actually no", { re: [ask.seq], to: ["lead"] });
    const s = at([...setup, ask, answer, out, second]);
    expect(open(s, ask)).toBe(false);
    expect(s.leadOwned.get(ask.seq)?.answer).toEqual({ by: "jon", seq: answer.seq, to: "lead" });
    expect([wants("lead", answer, s), wants("spare", answer, s)]).toEqual([true, false]);
    expect([wants("lead", second, s), wants("spare", second, s)]).toEqual([true, false]);
  });

  test("only asks put to people are the duty's, and only an entitled answer settles one", async () => {
    const setup = await channel();
    const toAgent = await say("lead", "ask", "Is the build green?", { to: ["dev"] });
    const toPerson = await say("lead", "ask", "Ship 2.0 today?", { to: ["jon"], esc: true });
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const agentReply = await say("dev", "msg", "green", { re: [toAgent.seq], to: ["lead"] });
    const aside = await say("bo", "msg", "I'd wait", { re: [toPerson.seq], to: ["lead"] });
    const s = at([...setup, toAgent, toPerson, out, agentReply, aside]);
    expect(s.leadOwned.has(toAgent.seq)).toBe(false);
    expect(s.leadOwned.get(toPerson.seq)?.answer).toBeUndefined();
    expect([wants("lead", agentReply, s), wants("spare", agentReply, s)]).toEqual([true, false]);
    expect([wants("lead", aside, s), wants("spare", aside, s)]).toEqual([true, false]);
  });
});

describe("one resolution for a lead's ask: open state, record and delivery agree", () => {
  test("a plain ask to a person is settled by anyone but its author, as any plain ask is, and that answer reaches the lead on duty", async () => {
    const setup = await channel();
    const ask = await say("lead", "ask", "Anyone against shipping today?", { to: ["jon"] });
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const answer = await say("bo", "msg", "not me", { re: [ask.seq], to: ["lead"] });
    const log = [...setup, ask, out, answer];
    const view = (s: ChannelState) => ({ open: open(s, ask), by: s.leadOwned.get(ask.seq)?.answer?.by, spare: wants("spare", answer, s), lead: wants("lead", answer, s) });
    const want = { open: false, by: "bo", spare: true, lead: false };
    expect(view(at(log))).toEqual(want);
    for (let cut = 1; cut < log.length; cut++) expect({ cut, ...view(resumedAt(log, cut)) }).toEqual({ cut, ...want });
  });

  test("an answer accepted under a power stays the answer after the power is taken back, on replay and on restore", async () => {
    const setup = await channel();
    const grant = await ev("jon", { op: "power.set", member: "bo", pk: ids.bo!.pk, was: false, power: "answersDecisions", on: true });
    const ask = await say("lead", "ask", "Ship 2.0 today?", { to: ["jon"], esc: true });
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const answer = await say("bo", "msg", "yes", { re: [ask.seq], to: ["lead"] });
    const revoke = await ev("jon", { op: "power.set", member: "bo", pk: ids.bo!.pk, was: true, power: "answersDecisions", on: false });
    const log = [...setup, grant, ask, out, answer, revoke];
    const view = (s: ChannelState) => ({
      refused: [grant, revoke].filter((e) => s.rejected.has(e.seq)).length,
      power: !!s.members.get("bo")?.answersDecisions,
      open: open(s, ask),
      by: s.leadOwned.get(ask.seq)?.answer?.by,
      spare: wants("spare", answer, s),
      lead: wants("lead", answer, s),
    });
    const want = { refused: 0, power: false, open: false, by: "bo", spare: true, lead: false };
    expect(view(at(log))).toEqual(want);
    for (let cut = 1; cut < log.length; cut++) expect({ cut, ...view(resumedAt(log, cut)) }).toEqual({ cut, ...want });
  });

  test("a reply to an ask already closed settles nothing and keeps its ordinary delivery", async () => {
    const setup = await channel();
    const ask = await say("lead", "ask", "Ship 2.0 today?", { to: ["jon"], esc: true });
    const closed = await say("lead", "event", "", { ev: { op: "ask.close", ask: ask.seq }, re: [ask.seq] });
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const back = await ev("spare", { op: "lead.duty", to: "lead", from: out.seq });
    const out2 = await ev("lead", { op: "lead.duty", to: "spare", from: back.seq });
    const late = await say("jon", "msg", "yes", { re: [ask.seq], to: ["lead"] });
    const log = [...setup, ask, closed, out, back, out2, late];
    const view = (s: ChannelState) => ({ rejected: s.rejected.has(closed.seq), answer: s.leadOwned.get(ask.seq)?.answer ?? null, spare: wants("spare", late, s), lead: wants("lead", late, s) });
    const want = { rejected: false, answer: null, spare: false, lead: true };
    expect(view(at(log))).toEqual(want);
    for (let cut = 1; cut < log.length; cut++) expect({ cut, ...view(resumedAt(log, cut)) }).toEqual({ cut, ...want });
  });

  test("a reply to a closed decision handed to the Lead doesn't become its answer", async () => {
    const setup = await channel();
    const ask = await handed("Which database?");
    const closed = await say("dev", "event", "", { ev: { op: "ask.close", ask: ask.seq }, re: [ask.seq] });
    const out = await ev("lead", { op: "lead.duty", to: "spare", from: 0 });
    const late = await say("spare", "msg", "sqlite", { re: [ask.seq], to: ["dev"] });
    const log = [...setup, ask, closed, out, late];
    expect(at(log).leadAsks.get(ask.seq)?.answer).toBeUndefined();
    for (let cut = 1; cut < log.length; cut++) expect({ cut, answer: resumedAt(log, cut).leadAsks.get(ask.seq)?.answer ?? null }).toEqual({ cut, answer: null });
  });
});

describe("what the lead owes, in a snapshot", () => {
  test("lead asks and lead-owned asks cross the wire, and a malformed snapshot is refused", async () => {
    const setup = await channel();
    const ask = await handed("Which database?");
    const own = await say("lead", "ask", "Ship 2.0 today?", { to: ["jon"], esc: true });
    let base: FoldBase | null = null;
    fold([...setup, ask, own], roster, now(), null, null, null, (b) => void (base = b));
    const wire = JSON.parse(JSON.stringify(toWire(base!))) as Record<string, unknown>;
    const back = baseFromWire(wire);
    expect(back?.leadAsks).toEqual([[ask.seq, { sentTo: "lead", from: "dev", plain: true }]]);
    expect(back?.leadOwned).toEqual([[own.seq, { author: "lead", to: ["jon"], esc: true, plain: true }]]);
    const legacy = { ...wire };
    delete legacy.leadAsks;
    delete legacy.leadOwned;
    expect(baseFromWire(legacy)).not.toBeNull();
    const badAsks = [
      {},
      [[ask.seq]],
      [[ask.seq, { sentTo: "lead", from: "dev" }]],
      [["x", { sentTo: "lead", from: "dev", plain: true }]],
      [[ask.seq, { sentTo: "lead", from: "dev", plain: true, answer: { by: 3 } }]],
    ];
    expect(badAsks.map((leadAsks) => baseFromWire({ ...wire, leadAsks }))).toEqual(badAsks.map(() => null));
    const owned = { author: "lead", to: ["jon"], esc: true, plain: true };
    const badOwned = [{}, [[own.seq, {}]], [[own.seq, { ...owned, author: "" }]], [[own.seq, { ...owned, to: [] }]], [[own.seq, { ...owned, answer: { by: "jon", seq: 9 } }]]];
    expect(badOwned.map((leadOwned) => baseFromWire({ ...wire, leadOwned }))).toEqual(badOwned.map(() => null));
  });
});
