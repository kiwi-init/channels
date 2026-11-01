import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { received } from "@kiwi/core/client/history.ts";
import { newChannelKey } from "@kiwi/core/crypto.ts";
import { describeEvent } from "@kiwi/core/format.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { EVENT_OPS_VERSION, isQuiet, knownOp, outgrown, PROTOCOL_VERSION, wellFormed, type Event, type Message } from "@kiwi/core/protocol.ts";
import { openSnapshot, sealSnapshot } from "@kiwi/core/snapshot.ts";
import { fold, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { outgrownCache } from "../src/agent/state.ts";
import { logLines } from "@kiwi/app/log-export.ts";

const T0 = 1_760_000_000_000;
const fixture = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "newer-ops-log.json"), "utf8")) as {
  members: { jow: string; ann: string };
  log: { seq: number; rts: number; payload: unknown }[];
};
const roster: Roster = [
  { name: "jow", pk: fixture.members.jow, owner: true, at: 0, active: true, kind: "human" },
  { name: "ann", pk: fixture.members.ann, owner: false, at: 0, active: true, kind: "agent", scopes: ["post", "tasks", "facts"] },
];

async function decoded(): Promise<Message[]> {
  const out: Message[] = [];
  for (const row of fixture.log) {
    if (!wellFormed(row.payload)) throw new Error(`#${row.seq} is malformed`);
    out.push(received(row.payload, row.seq, row.rts, await verify(row.payload)));
  }
  return out;
}

function baseOf(messages: Message[]): FoldBase {
  let base: FoldBase | null = null;
  fold(messages, roster, T0 + 3_600_000, null, null, null, (b) => void (base = b));
  if (!base) throw new Error("no base");
  return base;
}

const board = (messages: Message[]) => {
  const s = fold(messages, roster, T0 + 3_600_000);
  return {
    tasks: [...s.tasks.values()].map((t) => ({
      id: t.id,
      title: t.title,
      state: t.state,
      owner: t.owner,
      approvedBy: t.approvedBy,
      source: t.source,
      rounds: t.rounds.map((r) => ({ n: r.n, at: r.at, result: r.result.kind })),
    })),
    facts: [...s.facts.values()].map((f) => [f.key, f.value]),
    reactions: [...s.reactions].map(([seq, by]) => [seq, [...by].map(([name, r]) => [name, r.emoji])]),
    rejected: [...s.rejected],
    trust: [...s.trust],
  };
};

const OPS: Record<Event["op"], true> = {
  hello: true,
  "task.add": true,
  "task.claim": true,
  "task.update": true,
  card: true,
  claim: true,
  release: true,
  "fact.set": true,
  "fact.del": true,
  "lease.take": true,
  "lease.free": true,
  "role.set": true,
  "role.refuse": true,
  "power.set": true,
  "room.seal": true,
  "room.msg": true,
  "seat.reclaim": true,
  "color.set": true,
  "picture.set": true,
  "scope.set": true,
  "mode.set": true,
  "room.create": true,
  "room.rename": true,
  "charter.set": true,
  "compact.propose": true,
  compact: true,
  "repos.set": true,
  github: true,
  "github.rules": true,
  "github.release": true,
  "github.write.set": true,
  "branch.prefix.set": true,
  "ask.name": true,
  "ask.close": true,
  devices: true,
  "task.first": true,
  "hold.set": true,
  "voice.set": true,
  react: true,
  "msg.edit": true,
  "msg.delete": true,
  "room.leave": true,
  "member.gone": true,
  "member.back": true,
};
const V1 = [
  "hello",
  "task.add",
  "task.claim",
  "task.update",
  "card",
  "claim",
  "release",
  "fact.set",
  "fact.del",
  "lease.take",
  "lease.free",
  "role.set",
  "role.refuse",
  "seat.reclaim",
  "color.set",
  "picture.set",
  "scope.set",
  "mode.set",
  "room.create",
  "room.rename",
  "charter.set",
  "compact.propose",
  "compact",
  "repos.set",
  "github",
  "github.write.set",
  "hold.set",
  "voice.set",
  "react",
];
const OPS_AT: Record<number, readonly string[]> = {
  1: V1,
  2: [...V1, "branch.prefix.set"],
  3: [...V1, "branch.prefix.set", "github.rules"],
  4: [...V1, "branch.prefix.set", "github.rules", "github.release"],
  5: [...V1, "branch.prefix.set", "github.rules", "github.release", "ask.name"],
  6: [...V1, "branch.prefix.set", "github.rules", "github.release", "ask.name", "ask.close"],
  7: [...V1, "branch.prefix.set", "github.rules", "github.release", "ask.name", "ask.close", "devices", "task.first"],
  8: [...V1, "branch.prefix.set", "github.rules", "github.release", "ask.name", "ask.close", "devices", "task.first", "power.set"],
  9: [...V1, "branch.prefix.set", "github.rules", "github.release", "ask.name", "ask.close", "devices", "task.first", "power.set", "room.seal", "room.msg"],
  10: [...V1, "branch.prefix.set", "github.rules", "github.release", "ask.name", "ask.close", "devices", "task.first", "power.set", "room.seal", "room.msg", "msg.edit", "msg.delete"],
  11: [...V1, "branch.prefix.set", "github.rules", "github.release", "ask.name", "ask.close", "devices", "task.first", "power.set", "room.seal", "room.msg", "msg.edit", "msg.delete"],
  12: [
    ...V1,
    "branch.prefix.set",
    "github.rules",
    "github.release",
    "ask.name",
    "ask.close",
    "devices",
    "task.first",
    "power.set",
    "room.seal",
    "room.msg",
    "msg.edit",
    "msg.delete",
    "member.gone",
    "member.back",
  ],
  13: [
    ...V1,
    "branch.prefix.set",
    "github.rules",
    "github.release",
    "ask.name",
    "ask.close",
    "devices",
    "task.first",
    "power.set",
    "room.seal",
    "room.msg",
    "msg.edit",
    "msg.delete",
    "member.gone",
    "member.back",
    "room.leave",
  ],
};

describe("events from a newer client", () => {
  test("every op the Event type has is known, and a new op needs EVENT_OPS_VERSION raised with it", () => {
    for (const op of Object.keys(OPS)) expect(knownOp(op)).toBe(true);
    expect(knownOp("evidence")).toBe(false);
    expect([...(OPS_AT[EVENT_OPS_VERSION] ?? [])].sort()).toEqual(Object.keys(OPS).sort());
  });

  test("a signed log with two ops this client doesn't know decodes whole: every signature checks out, and those two keep their op as newer", async () => {
    const messages = await decoded();
    expect(messages.map((m) => m.sigOk)).toEqual(messages.map(() => true));
    expect(messages.filter((m) => m.newer !== undefined).map((m) => [m.seq, m.newer?.op, m.ev, m.body])).toEqual([
      [5, "evidence", undefined, "evidence on W2: sha 1a2b3c"],
      [9, "work.pass", undefined, "passed W2 to the rack"],
    ]);
    expect(messages.filter((m) => m.newer !== undefined).every((m) => isQuiet(m))).toBe(true);
  });

  test("they fold to nothing: the board is the one the same log folds to without them, and the old log still folds to the same board", async () => {
    const messages = await decoded();
    const without = messages.filter((m) => m.newer === undefined);
    const withNewer = board(messages);
    const withoutNewer = board(without);
    expect({ ...withNewer, trust: withNewer.trust.filter(([seq]) => seq !== 5 && seq !== 9) }).toEqual(withoutNewer);
    expect(withoutNewer.tasks).toEqual([{ id: 2, title: "Write the docs", state: "done", owner: "ann", approvedBy: "jow", source: 1, rounds: [{ n: 1, at: "1a2b3c", result: "approved" }] }]);
    expect(withoutNewer.facts).toEqual([["docs/branch", "T2-docs"]]);
    expect(withoutNewer.reactions).toEqual([[1, [["jow", "👍"]]]]);
    expect(withoutNewer.rejected).toEqual([]);
    expect(withNewer.trust.filter(([seq]) => seq === 5 || seq === 9)).toEqual([
      [5, "verified"],
      [9, "verified"],
    ]);
    expect(fold(messages, roster, T0 + 3_600_000).placeOf.get(5)).toEqual({ kind: "main" });
  });

  test("an export writes such an event back whole, as it was signed, so its line still verifies", async () => {
    const messages = await decoded();
    const lines = logLines(messages)
      .trimEnd()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[4]!.ev).toEqual({ op: "evidence", work: 2, ref: { kind: "sha", repo: "o/r", sha: "1a2b3c" }, ok: true });
    expect(lines[4]!.newer).toBeUndefined();
    const signed = lines.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== "seq" && k !== "rts" && k !== "sigOk")));
    expect(await Promise.all(signed.map((l) => verify(l)))).toEqual(lines.map(() => true));
  });

  test("a known op with a bad shape is still refused, and so is an op that isn't a plain short name", () => {
    const base = { v: PROTOCOL_VERSION, id: "x", from: "ann", kind: "event", body: "", ts: T0 };
    expect(wellFormed({ ...base, ev: { op: "evidence", work: 2 } })).toBe(true);
    expect(wellFormed({ ...base, ev: { op: "task.add" } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "react", seq: "1", emoji: "👍" } })).toBe(false);
    for (const op of ["Evidence", "a/b", "../x", "x..y", "-x", "", "a".repeat(41), 7]) expect(wellFormed({ ...base, ev: { op } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "a".repeat(40) } })).toBe(true);
  });

  test("a base folded past an op records what it skipped, and a client that knows more ops than its folder doesn't build on it", async () => {
    const messages = await decoded();
    const base = baseOf(messages);
    expect(base.folded).toBe(EVENT_OPS_VERSION);
    expect(base.skipped).toBe(true);
    expect(outgrown(base)).toBe(false);
    expect(baseOf(messages.filter((m) => m.newer === undefined)).skipped).toBeUndefined();
    const older = { ...base, folded: EVENT_OPS_VERSION - 1 };
    expect(outgrown(older)).toBe(true);
    expect(outgrown({ ...older, skipped: undefined })).toBe(false);
  });

  test("the CLI drops its cache when it now knows an op a cached message carries as newer, or when its base is outgrown", async () => {
    const messages = await decoded();
    const base = baseOf(messages);
    expect(outgrownCache(messages, base)).toBe(false);
    expect(outgrownCache([...messages, { ...messages[0]!, seq: 11, kind: "event", newer: { op: "react" } }], base)).toBe(true);
    expect(outgrownCache(messages, { ...base, folded: undefined })).toBe(true);
    expect(outgrownCache(messages, null)).toBe(false);
  });

  test("a snapshot whose fold skipped ops the reader knows is refused, so the reader folds the history instead", async () => {
    const messages = await decoded();
    const owner = await generateIdentity("jow");
    const access = { roomId: "cd".repeat(16), ownerPk: owner.pk, ownerXpk: owner.xpk ?? "", epoch: 0, keys: { "0": newChannelKey() } };
    const base = baseOf(messages);
    const kept = await openSnapshot(access, await sealSnapshot(owner, access, base));
    expect(kept?.n).toBe(10);
    expect(kept?.skipped).toBe(true);
    const older = await sealSnapshot(owner, access, { ...base, folded: EVENT_OPS_VERSION - 1 });
    expect(older).not.toBeNull();
    expect(await openSnapshot(access, older)).toBeNull();
  });
});

describe("voice.set, from when Channels had voice", () => {
  test("an old log's voice.set still verifies and folds to nothing: the owner's changes no state, anyone else's is refused as before", async () => {
    const jow = await generateIdentity("jow");
    const ann = await generateIdentity("ann");
    const people: Roster = [
      { name: "jow", pk: jow.pk, owner: true, at: 0, active: true, kind: "human" },
      { name: "ann", pk: ann.pk, owner: false, at: 0, active: true, kind: "agent" },
    ];
    const voiceSet = async (id: Identity, seq: number, on: boolean): Promise<Message> => {
      const p = await sign(id, { v: PROTOCOL_VERSION, id: crypto.randomUUID(), from: id.name, kind: "event" as const, body: "", ev: { op: "voice.set" as const, on }, ts: T0 + seq });
      if (!wellFormed(p)) throw new Error(`#${seq} is malformed`);
      return received(p, seq, T0 + seq, await verify(p));
    };
    const allowed = await voiceSet(jow, 1, true);
    const byAgent = await voiceSet(ann, 2, true);
    const off = await voiceSet(jow, 3, false);
    expect([allowed, byAgent, off].map((m) => [m.sigOk, m.ev?.op, m.newer])).toEqual([
      [true, "voice.set", undefined],
      [true, "voice.set", undefined],
      [true, "voice.set", undefined],
    ]);
    const s = fold([allowed, byAgent, off], people, T0 + 3_600_000);
    expect([...s.rejected]).toEqual([[2, "only the owner allows voice in the channel"]]);
    expect(Object.hasOwn(s, "voice")).toBe(false);
    expect(describeEvent(allowed)).toBe("allowed voice in the channel (gone: Channels no longer has voice)");
    expect(describeEvent(off)).toBe("turned voice off for the channel (gone: Channels no longer has voice)");
    const base = { v: PROTOCOL_VERSION, id: "x", from: "jow", kind: "event", body: "", ts: T0 };
    expect(wellFormed({ ...base, ev: { op: "voice.set", on: "yes" } })).toBe(false);
    expect(wellFormed({ ...base, ev: { op: "voice.set" } })).toBe(false);
  });

  test("a snapshot sealed while it carried voice still opens, and folds without it", async () => {
    const owner = await generateIdentity("jow");
    const access = { roomId: "ef".repeat(16), ownerPk: owner.pk, ownerXpk: owner.xpk ?? "", epoch: 0, keys: { "0": newChannelKey() } };
    const base = baseOf((await decoded()).filter((m) => m.newer === undefined));
    const kept = await openSnapshot(access, await sealSnapshot(owner, access, { ...base, voice: true }));
    expect(kept?.voice).toBe(true);
    expect(Object.hasOwn(fold([], roster, T0 + 3_600_000, null, null, kept), "voice")).toBe(false);
  });
});
