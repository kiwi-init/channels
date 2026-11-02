import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Channel } from "@kiwi/core/client.ts";
import { received } from "@kiwi/core/client/history.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { FOLD_RULES, olderRules, PROTOCOL_VERSION, type Event, type Message, type Payload } from "@kiwi/core/protocol.ts";
import { omit } from "@kiwi/core/omit.ts";
import { fold, rosterOf, type ChannelState, type FoldBase } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, joinPerson, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

const NOT_YOURS = "only the owner, the key itself, or the person an agent works for says a key is gone";
const NOT_A_MANAGER = "only the owner, or a person who manages agents, names an agent";
const TRUSTED = { addsAgents: true, answersDecisions: true, managesAgents: true };

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-own-agents-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
type Seat = { id: Identity; ch: Channel };
let maya: Seat;
let tia: Seat;
let zed: Seat;
let mo: Seat;
let mi: Seat;
let ty: Seat;
let jo: Seat;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  const mayaPerson = await generateIdentity("maya-person");
  const tiaPerson = await generateIdentity("tia-person");
  maya = await joinPerson(s, "maya", mayaPerson);
  tia = await joinPerson(s, "tia", tiaPerson, TRUSTED);
  zed = await joinPerson(s, "zed", await generateIdentity("zed-person"));
  const mayaComputer = await pairComputer(mayaPerson);
  mo = await joinAgent(s, "mo", mayaComputer);
  mi = await joinAgent(s, "mi", mayaComputer);
  ty = await joinAgent(s, "ty", await pairComputer(tiaPerson));
  jo = await joinAgent(s, "jo", await pairComputer(s.person));
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function log(): Promise<Message[]> {
  return (await s.ownerCh.history(0)).messages;
}

async function judged(extra: Message[] = []): Promise<ChannelState> {
  return fold([...(await log()), ...extra], rosterOf(await s.ownerCh.members()), Date.now());
}

async function injected(who: Seat, body: string, seq: number): Promise<Message> {
  const payload: Payload = { v: PROTOCOL_VERSION, id: crypto.randomUUID(), from: who.id.name, kind: "msg", body, ts: Date.now() };
  const signed = await sign(who.id, payload);
  return received(signed, seq, Date.now(), await verify(signed));
}

const say = (by: Seat, ev: Event): Promise<number> => by.ch.send(ev.op, { kind: "event", ev });
const removes = (by: Seat, target: Seat): Promise<number> => say(by, { op: "member.gone", member: target.id.name, pk: target.id.pk });
const names = (by: Seat, target: Seat, nickname: string | null): Promise<number> => say(by, { op: "nickname.set", member: target.id.name, pk: target.id.pk, nickname });
const relayHas = async (who: Seat): Promise<boolean> => !!(await s.ownerCh.members()).find((m) => m.pk === who.id.pk)?.active;

describe("people remove their own agents, the owner removes anyone, and people who manage agents rename them (T1673)", () => {
  test("the agents' records name the person they work for", () => {
    expect([mo, mi].map((a) => (a as Seat & { member: { sponsor?: { handle?: string } } }).member.sponsor?.handle)).toEqual(["maya", "maya"]);
  });

  test("someone else's agent is refused, even for a person the owner fully trusts", async () => {
    const byTrusted = await removes(tia, mi);
    const byOther = await removes(maya, ty);
    const ownersAgent = await removes(maya, jo);
    const state = await judged();
    for (const seq of [byTrusted, byOther, ownersAgent]) expect(state.rejected.get(seq)).toBe(NOT_YOURS);
    for (const a of [mi, ty, jo]) {
      expect(state.gone.has(a.id.pk)).toBe(false);
      expect(state.members.get(a.id.name)?.active).toBe(true);
    }
    expect(await s.ownerCh.reconcilePosting(state, await s.ownerCh.members())).toEqual([]);
    for (const a of [mi, ty, jo]) expect(await relayHas(a)).toBe(true);
  });

  test("removing a person or the owner is refused for anyone but the owner, fully trusted or not", async () => {
    const owner = { id: s.owner, ch: s.ownerCh };
    const tries = [await removes(maya, tia), await removes(tia, maya), await removes(tia, owner), await removes(maya, owner), await removes(mo, maya)];
    const state = await judged();
    for (const seq of tries) expect(state.rejected.get(seq)).toBe(NOT_YOURS);
    for (const p of [maya, tia, owner]) expect(state.gone.has(p.id.pk)).toBe(false);
  });

  test("a person removes their own agent: every fold drops it at once, and the owner's app cuts it at the relay and rotates the keys", async () => {
    const before = (await s.ownerCh.info()).epoch;
    const seq = await removes(maya, mo);
    const state = await judged();
    expect(state.rejected.get(seq)).toBeUndefined();
    expect(state.gone.get(mo.id.pk)).toBe(seq);
    expect(state.members.get("mo")?.active).toBe(false);
    expect(state.members.get("mi")?.active).toBe(true);
    expect(await relayHas(mo)).toBe(true);

    expect(await s.ownerCh.reconcilePosting(state, await s.ownerCh.members())).toEqual([mo.id.pk]);
    expect(await relayHas(mo)).toBe(false);
    expect(await relayHas(mi)).toBe(true);
    expect((await s.ownerCh.info()).epoch).toBeGreaterThan(before);
    expect(await s.ownerCh.reconcilePosting(await judged(), await s.ownerCh.members())).toEqual([]);

    const head = (await log()).at(-1)!.seq;
    const late = await injected(mo, "a relay slipped this in", head + 1);
    expect((await judged([late])).rejected.get(late.seq)).toBe("sent after its key was removed");
    await expect(mo.ch.send("still here?")).rejects.toThrow();
  });

  test("the owner still removes anyone: another person's agent, and a person", async () => {
    await s.ownerCh.remove(ty.id.pk);
    await s.ownerCh.remove(zed.id.pk);
    const state = await judged();
    for (const gone of [ty, zed]) {
      expect(state.gone.has(gone.id.pk)).toBe(true);
      expect(state.members.get(gone.id.name)?.active).toBe(false);
      expect(await relayHas(gone)).toBe(false);
    }
    expect(state.rejected.size).toBe((await judged()).rejected.size);
  });

  test("a person the owner fully trusts renames another person's agent and changes its role; the owner's app signs the nickname into its record", async () => {
    const renamed = await names(tia, mi, "Scout");
    const role = await say(tia, { op: "role.set", member: "mi", role: "reviewer" });
    const byMaya = await names(maya, mi, "Nope");
    const aPerson = await names(tia, maya, "Mags");
    const state = await judged();
    expect(state.rejected.get(renamed)).toBeUndefined();
    expect(state.rejected.get(role)).toBeUndefined();
    expect(state.rejected.get(byMaya)).toBe(NOT_A_MANAGER);
    expect(state.rejected.get(aPerson)).toBe(NOT_A_MANAGER);
    expect(state.members.get("mi")?.display).toBe("Scout");
    expect(state.roleSets.get("mi")?.role).toBe("reviewer");
    expect(state.members.get("maya")?.display).toBeUndefined();

    const roster = await s.ownerCh.members();
    let base: FoldBase | null = null;
    fold(await log(), rosterOf(roster), Date.now(), null, null, null, (b) => (base = b));
    expect(fold([], rosterOf(roster), Date.now(), null, null, base).members.get("mi")?.display).toBe("Scout");

    expect(await s.ownerCh.reconcilePosting(state, roster)).toContain(mi.id.pk);
    const record = (await s.ownerCh.members()).find((m) => m.pk === mi.id.pk);
    expect(record?.display).toBe("Scout");
    expect(record?.laterRole?.role).toBe("reviewer");
    expect(await s.ownerCh.reconcilePosting(await judged(), await s.ownerCh.members())).toEqual([]);

    const cleared = await names(tia, mi, null);
    const after = await judged();
    expect(after.rejected.get(cleared)).toBeUndefined();
    expect(after.members.get("mi")?.display).toBeUndefined();
    await s.ownerCh.reconcilePosting(after, await s.ownerCh.members());
    expect((await s.ownerCh.members()).find((m) => m.pk === mi.id.pk)?.display).toBeUndefined();
  });

  test("a channel opened from a snapshot taken before these rules folds to the same state as its whole log", async () => {
    const messages = await log();
    const roster = rosterOf(await s.ownerCh.members());
    const cut = messages.find((m) => m.ev?.op === "member.gone" && m.from === "maya" && m.ev.member === "mo")!.seq - 1;
    let base: FoldBase | null = null;
    fold(
      messages.filter((m) => m.seq <= cut),
      roster,
      Date.now(),
      null,
      null,
      null,
      (b) => (base = b),
    );
    const older: FoldBase = { ...omit(base!, "nicknames"), rules: FOLD_RULES - 1 };
    expect(olderRules(older)).toBe(true);
    const whole = fold(messages, roster, Date.now());
    const resumed = fold(
      messages.filter((m) => m.seq > cut),
      roster,
      Date.now(),
      null,
      null,
      older,
    );
    const view = (st: ChannelState) => ({
      gone: [...st.gone].sort(),
      nicknames: [...st.nicknames].sort(),
      members: [...st.members.values()].map((m) => [m.name, m.active, m.display ?? null]).sort(),
      rejected: [...st.rejected].filter(([seq]) => seq > cut).sort(),
    });
    expect(view(resumed)).toEqual(view(whole));
    expect(resumed.members.get("mo")?.active).toBe(false);
  });
});
