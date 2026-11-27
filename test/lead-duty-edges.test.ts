import { beforeAll, describe, expect, test } from "bun:test";
import { leadsNow, namesOffDutyLead, offDutyHint, offDutyLeads } from "@kiwi/core/duty.ts";
import { formatStatus, statusJson } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { EVENT_OPS_VERSION, PROTOCOL_VERSION, type Event, type Kind, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { baseFromWire, toWire } from "@kiwi/core/base-wire.ts";
import { fold, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { wants } from "../src/agent/wants.ts";

const T0 = 1_760_000_000_000;
const at = (s: number) => T0 + s * 1_000;
const ids: Record<string, Identity> = {};
let roster: Roster;
beforeAll(async () => {
  for (const n of ["jow", "lead", "spare", "zed", "ann"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "lead", pk: ids.lead!.pk, owner: false, at: 1, active: true, kind: "agent", role: "lead" },
    { name: "spare", pk: ids.spare!.pk, owner: false, at: 2, active: true, kind: "agent" },
    { name: "zed", pk: ids.zed!.pk, owner: false, at: 3, active: true, kind: "agent" },
    { name: "ann", pk: ids.ann!.pk, owner: false, at: 4, active: true, kind: "agent" },
  ];
});

type Extra = Partial<Pick<Message, "to" | "ev" | "re" | "room" | "dm" | "task">>;

async function channel() {
  const log: Message[] = [];
  const say = async (from: string, kind: Kind, body: string, extra: Extra = {}): Promise<Message> => {
    const seq = log.length + 1;
    const payload: Payload = { v: PROTOCOL_VERSION, id: `s${seq}`, from, kind, body, ts: at(seq), ops: EVENT_OPS_VERSION, ...extra };
    const p = await sign(ids[from]!, payload);
    const m = { ...p, seq, rts: at(seq), sigOk: await verify(p) };
    log.push(m);
    return m;
  };
  const ev = (from: string, e: Event) => say(from, "event", "", { ev: e });
  const state = () => fold(log, roster, at(10_000));
  const hand = (from: string, to: string, checkpoint: string) => ev(from, { op: "lead.duty", to, from: state().duty?.since ?? 0, checkpoint });
  await ev("jow", { op: "lead.standby", name: "spare", on: true });
  await ev("jow", { op: "lead.standby", name: "zed", on: true });
  return { log, say, ev, state, hand };
}

describe("messages to an off-duty lead (#19397 box 12)", () => {
  test("a message, reply or mention naming the off-duty lead tells the sender who is on duty; nobody is off duty before a handover", async () => {
    const c = await channel();
    expect(offDutyLeads(c.state())).toEqual([]);
    expect(offDutyHint(c.state(), ["lead"])).toBeNull();
    await c.hand("lead", "spare", "nothing open");
    const s = c.state();
    expect(offDutyLeads(s)).toEqual(["lead"]);
    expect(offDutyHint(s, ["lead"])).toBe("lead is off duty; spare is the lead on duty");
    expect(offDutyHint(s, ["@Lead", "ann"])).toBe("lead is off duty; spare is the lead on duty");
    expect(offDutyHint(s, ["spare", "ann"])).toBeNull();
    await c.hand("spare", "zed", "nothing open");
    expect(offDutyLeads(c.state())).toEqual(["lead", "spare"]);
    expect(offDutyHint(c.state(), ["spare", "lead"])).toBe("spare, lead are off duty; zed is the lead on duty");
    await c.hand("zed", "lead", "nothing open");
    expect(offDutyLeads(c.state())).toEqual(["spare", "zed"]);
    expect(offDutyHint(c.state(), ["lead"])).toBeNull();
  });

  test("a mention in a room both seats can read reaches the lead on duty; a direct message stays with its reader, with no entry for the standby", async () => {
    const c = await channel();
    await c.ev("jow", { op: "room.create", id: "ops", name: "ops" });
    await c.hand("lead", "spare", "nothing open");
    const room = await c.say("ann", "msg", "@lead can you name a reviewer?", { room: "ops" });
    const plain = await c.say("ann", "msg", "the export runs", { room: "ops" });
    const direct = await c.say("ann", "msg", "@lead a private word about the database", { to: ["lead"], dm: true });
    const s = c.state();
    expect(namesOffDutyLead(s, room)).toBe(true);
    expect(wants("spare", room, s)).toBe(true);
    expect(wants("zed", room, s)).toBe(false);
    expect(wants("spare", plain, s)).toBe(false);
    expect(namesOffDutyLead(s, direct)).toBe(false);
    expect(wants("spare", direct, s)).toBe(false);
    expect(wants("lead", direct, s)).toBe(true);
  });

  test("a reply to the off-duty lead's message in a room or a task thread reaches the lead on duty, with or without a to, and after a restore; asks and direct threads keep their audience", async () => {
    const c = await channel();
    await c.ev("jow", { op: "room.create", id: "ops", name: "ops" });
    const task = await c.ev("jow", { op: "task.add", title: "export" });
    const asked = await c.say("lead", "msg", "Which day?", { room: "ops" });
    const inTask = await c.say("lead", "msg", "Who reviews this?", { task: task.seq });
    const formal = await c.say("lead", "ask", "Is the build green?", { to: ["ann"], room: "ops" });
    const annSaid = await c.say("ann", "msg", "the export is slow", { room: "ops" });
    const privately = await c.say("lead", "msg", "a private word", { to: ["ann"], dm: true });
    await c.hand("lead", "spare", `T${task.seq} export: open, nobody on it; #${formal.seq} build question to ann`);
    expect(c.state().lead).toBe("spare");
    const reply = (parent: Message, body: string, addressed: boolean) =>
      c.say("ann", "msg", body, { re: [parent.seq], ...(addressed ? { to: [parent.from] } : {}), ...(parent.room ? { room: parent.room } : {}) });
    const reached = [await reply(asked, "Friday", true), await reply(asked, "or Monday", false), await reply(inTask, "zed can", true), await reply(inTask, "or ann", false)];
    const kept = [
      await reply(formal, "green", true),
      await c.say("lead", "msg", "I will look", { re: [annSaid.seq], to: ["ann"], room: "ops" }),
      await c.say("ann", "msg", "the export is done", { to: ["lead"], room: "ops" }),
    ];
    const direct = [await reply(privately, "the database password rotates tonight", true), await reply(privately, "and the key", false)];
    const s = c.state();
    expect(direct.map((m) => s.placeOf.get(m.seq)?.kind)).toEqual(["dm", "dm"]);
    const view = (st: ChannelState) => ({
      reached: reached.map((m) => [namesOffDutyLead(st, m), wants("spare", m, st), wants("zed", m, st)]),
      kept: kept.map((m) => wants("spare", m, st)),
      direct: direct.map((m) => [namesOffDutyLead(st, m), wants("spare", m, st), wants("lead", m, st)]),
    });
    const want = {
      reached: reached.map(() => [true, true, false]),
      kept: kept.map(() => false),
      direct: direct.map(() => [false, false, true]),
    };
    expect(view(s)).toEqual(want);
    let base: FoldBase | null = null;
    fold(c.log.slice(0, asked.seq + 1), roster, at(10_000), null, null, null, (b) => void (base = b));
    const restored = baseFromWire(JSON.parse(JSON.stringify(toWire(base!))) as Record<string, unknown>);
    expect(restored).not.toBeNull();
    expect(view(fold(c.log.slice(asked.seq + 1), roster, at(10_000), null, null, restored))).toEqual(want);
  });
});

describe("the lead on duty keeps the former lead's records (#19397 box 13)", () => {
  test("ticks and edits a spec, and sets a note and a goal, that the former lead wrote; another agent can't name the goal", async () => {
    const c = await channel();
    const head = await c.say("jow", "msg", "plan the export");
    await c.ev("lead", { op: "spec.set", ask: head.seq, text: "## Done when\n- [ ] export runs\n- [ ] docs" });
    await c.ev("jow", { op: "spec.approve", ask: head.seq, v: c.state().specs.get(head.seq)!.v });
    await c.ev("lead", { op: "fact.set", key: "release plan", value: "ship on Friday" });
    await c.ev("lead", { op: "ask.name", ask: head.seq, name: "export ships" });
    await c.hand("lead", "spare", "nothing open");
    const tick = await c.ev("spare", { op: "spec.set", ask: head.seq, text: "## Done when\n- [x] export runs\n- [ ] docs" });
    const edit = await c.ev("spare", { op: "spec.set", ask: head.seq, text: "## Done when\n- [x] export runs\n- [ ] docs, in two languages" });
    const note = await c.ev("spare", { op: "fact.set", key: "release plan", value: "ship on Monday" });
    const goal = await c.ev("spare", { op: "ask.name", ask: head.seq, name: "export ships on Monday" });
    const other = await c.ev("ann", { op: "ask.name", ask: head.seq, name: "not mine to name" });
    const s = c.state();
    expect([tick, edit, note, goal].map((m) => s.rejected.get(m.seq) ?? null)).toEqual([null, null, null, null]);
    expect(s.rejected.get(other.seq)).toBe("only the lead, the owner or the person who asked names a goal");
    const spec = s.specs.get(head.seq)!;
    expect(spec.text).toContain("- [x] export runs");
    expect(spec.approved?.v).toBe(edit.seq);
    expect(s.facts.get("release plan")).toMatchObject({ value: "ship on Monday", by: "spare" });
    expect(s.askHeads.get(head.seq)).toMatchObject({ goal: "export ships on Monday", goalBy: "spare" });
  });

  test("the client's lead checks follow the duty: the standby on duty passes, the former lead doesn't", async () => {
    const c = await channel();
    expect([leadsNow(c.state(), "lead"), leadsNow(c.state(), "spare"), leadsNow(c.state(), "jow")]).toEqual([true, false, true]);
    await c.hand("lead", "spare", "nothing open");
    expect([leadsNow(c.state(), "lead"), leadsNow(c.state(), "spare"), leadsNow(c.state(), "jow")]).toEqual([false, true, true]);
  });
});

describe("kiwi status names the lead on duty and the standbys (#19397 box 15)", () => {
  const status = (s: ReturnType<typeof fold>, me: string) => formatStatus({ check: "kiwi/review/test", alias: "c", me, state: s, online: new Map(), unread: 0, now: at(10_000) });

  test("before a handover it reads as today plus the standbys; after it, each seat reads its part", async () => {
    const c = await channel();
    expect(status(c.state(), "ann")).toContain("lead: lead, who keeps the board");
    expect(status(c.state(), "ann")).toContain("standby leads: spare, zed");
    await c.hand("lead", "spare", "nothing open");
    const s = c.state();
    expect(status(s, "ann")).toContain("lead on duty: spare (the channel's own lead, lead, is off duty), who keeps the board");
    expect(status(s, "spare")).toContain("you are the lead on duty, standing in for lead: keep the board tidy");
    expect(status(s, "lead")).toContain("you are the channel's own lead, off duty: spare is the lead on duty until the lead is handed back (kiwi lead)");
    expect(statusJson({ alias: "c", me: "ann", state: s, online: new Map(), unread: 0 })).toMatchObject({ lead: "spare", homeLead: "lead", standbys: ["spare", "zed"] });
  });
});
