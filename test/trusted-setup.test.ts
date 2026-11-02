import { beforeAll, describe, expect, test } from "bun:test";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";

const ids: Record<string, Identity> = {};
let seq = 0;
async function ev(from: string, e: Event, key: Identity = ids[from]!): Promise<Message> {
  const at = ++seq;
  const base = { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ev: e, ts: at };
  const p = await sign(key, base);
  return { ...p, seq: at, rts: at, sigOk: await verify(p) };
}

const ALL = { addsAgents: true, answersDecisions: true, managesAgents: true } as const;

let roster: Roster;
beforeAll(async () => {
  for (const n of ["jow", "tia", "bo", "ro", "ana", "ana2"]) ids[n] = await generateIdentity(n);
  roster = [
    { name: "jow", pk: ids.jow!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "tia", pk: ids.tia!.pk, owner: false, at: 1, active: true, kind: "human", ...ALL },
    { name: "bo", pk: ids.bo!.pk, owner: false, at: 2, active: true, kind: "human", addsAgents: true },
    { name: "ro", pk: ids.ro!.pk, owner: false, at: 3, active: true, kind: "human", scopes: [], ...ALL },
  ];
});

const setup = (from: string) =>
  Promise.all([
    ev(from, { op: "repos.set", repos: ["kiwi-init/channels"] }),
    ev(from, { op: "charter.set", text: "Ship the app" }),
    ev(from, { op: "room.create", id: `r-${from}`, name: `room-${from}` }),
    ev(from, { op: "branch.prefix.set", prefix: "kiwi/" }),
  ]);

describe("a person the owner fully trusts sets up the channel (T632)", () => {
  test("repos, the charter, rooms and the branch prefix, as the owner does", async () => {
    const ms = await setup("tia");
    const rename = await ev("tia", { op: "room.rename", id: "r-tia", name: "renamed" });
    const s = fold([...ms, rename], roster);
    for (const m of [...ms, rename]) expect([m.seq, s.rejected.get(m.seq)]).toEqual([m.seq, undefined]);
    expect(s.repos).toEqual(["kiwi-init/channels"]);
    expect(s.charter?.text).toBe("Ship the app");
    expect(s.rooms.get("r-tia")?.name).toBe("renamed");
    expect(s.branchPrefix).toBe("kiwi/");
  });

  test("not someone with only some powers, nor one who may only read", async () => {
    const ms = [...(await setup("bo")), ...(await setup("ro"))];
    const s = fold(ms, roster);
    for (const m of ms) expect([m.seq, s.rejected.has(m.seq)]).toEqual([m.seq, true]);
    expect(s.repos).toEqual([]);
    expect([s.charter, s.branchPrefix, s.rooms.has("r-bo"), s.rooms.has("r-ro")]).toEqual([null, null, false, false]);
  });

  test("letting Kiwi write to GitHub, hold, and powers stay the owner's", async () => {
    const ms = [
      await ev("tia", { op: "github.write.set", on: true }),
      await ev("tia", { op: "hold.set", on: true }),
      await ev("tia", { op: "power.set", member: "bo", pk: ids.bo!.pk, power: "managesAgents", on: true, was: false }),
    ];
    const s = fold(ms, roster);
    for (const m of ms) expect([m.seq, s.rejected.has(m.seq)]).toEqual([m.seq, true]);
  });

  test("taking one power back keeps what they set while trusted and refuses what comes after, folded whole or from a snapshot", async () => {
    const repos = await ev("tia", { op: "repos.set", repos: ["kiwi-init/channels"] });
    const took = await ev("jow", { op: "power.set", member: "tia", pk: ids.tia!.pk, power: "answersDecisions", on: false, was: true });
    const charter = await ev("tia", { op: "charter.set", text: "too late" });
    const revoked = roster.map((r) => (r.name === "tia" ? { ...r, answersDecisions: undefined } : r));
    const whole = fold([repos, took, charter], revoked);
    expect([whole.rejected.has(repos.seq), whole.rejected.has(took.seq), whole.rejected.has(charter.seq)]).toEqual([false, false, true]);
    expect(whole.repos).toEqual(["kiwi-init/channels"]);
    expect(whole.charter).toBeNull();
    let base: FoldBase | null = null;
    fold([repos], roster, Date.now(), null, null, null, (b) => void (base = b));
    const resumed = fold([took, charter], revoked, Date.now(), null, null, base);
    expect([resumed.repos, resumed.charter, resumed.rejected.has(charter.seq)]).toEqual([["kiwi-init/channels"], null, true]);
  });

  test("trust given mid-log counts from where it lands", async () => {
    const before = await ev("bo", { op: "charter.set", text: "early" });
    const gave = [
      await ev("jow", { op: "power.set", member: "bo", pk: ids.bo!.pk, power: "answersDecisions", on: true, was: false }),
      await ev("jow", { op: "power.set", member: "bo", pk: ids.bo!.pk, power: "managesAgents", on: true, was: false }),
    ];
    const after = await ev("bo", { op: "charter.set", text: "now" });
    const trusted = roster.map((r) => (r.name === "bo" ? { ...r, ...ALL } : r));
    const s = fold([before, ...gave, after], trusted);
    expect([s.rejected.has(before.seq), s.rejected.has(after.seq), s.charter?.text]).toEqual([true, false, "now"]);
  });

  test("trust belongs to a key: someone who joins later under a former member's name gets none of it", async () => {
    const gave = await Promise.all(
      (["addsAgents", "answersDecisions", "managesAgents"] as const).map((power) => ev("jow", { op: "power.set", member: "ana", pk: ids.ana!.pk, power, on: true, was: false })),
    );
    const theirs = await ev("ana", { op: "charter.set", text: "set while trusted" });
    const newcomer = await ev("ana", { op: "repos.set", repos: ["someone/else"] }, ids.ana2!);
    const rejoined: Roster = [
      ...roster,
      { name: "ana", pk: ids.ana!.pk, owner: false, at: 4, active: false, kind: "human", ...ALL },
      { name: "ana", pk: ids.ana2!.pk, owner: false, at: 5, active: true, kind: "human" },
    ];
    const s = fold([...gave, theirs, newcomer], rejoined);
    expect([s.rejected.has(theirs.seq), s.charter?.text]).toEqual([false, "set while trusted"]);
    expect([s.rejected.has(newcomer.seq), s.repos]).toEqual([true, []]);
  });

  test("trusted from the record alone, without a power.set, it's still that key's record that counts", async () => {
    const theirs = await ev("ana", { op: "charter.set", text: "from the old seat" });
    const newcomer = await ev("ana", { op: "repos.set", repos: ["someone/else"] }, ids.ana2!);
    const rejoined: Roster = [
      ...roster,
      { name: "ana", pk: ids.ana!.pk, owner: false, at: 4, active: false, kind: "human", ...ALL },
      { name: "ana", pk: ids.ana2!.pk, owner: false, at: 5, active: true, kind: "human" },
    ];
    const s = fold([theirs, newcomer], rejoined);
    expect([s.rejected.has(theirs.seq), s.rejected.has(newcomer.seq)]).toEqual([false, true]);
  });

  test("a power.set in T443's shape still counts, as managing agents", async () => {
    const old = await ev("jow", { op: "power.set", member: "bo", pk: ids.bo!.pk, managesAgents: true, was: false });
    const rest = await ev("jow", { op: "power.set", member: "bo", pk: ids.bo!.pk, power: "answersDecisions", on: true, was: false });
    const after = await ev("bo", { op: "charter.set", text: "trusted now" });
    const s = fold(
      [old, rest, after],
      roster.map((r) => (r.name === "bo" ? { ...r, ...ALL } : r)),
    );
    expect([s.rejected.has(old.seq), s.rejected.has(after.seq), s.charter?.text]).toEqual([false, false, "trusted now"]);
  });
});
