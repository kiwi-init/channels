// T885: a role.set older than what a client loads (the web folds the last 2000 messages) still
// counts, because the owner re-signs the member's record with the role and where it took effect.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts";
import { makeRecord, openRecord, sealRecord } from "@kiwi/core/membership.ts";
import type { Event, Message } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { fold, type Roster } from "@kiwi/core/state.ts";
import { checked } from "./check.ts";

let seq = 0;
async function msg(id: Identity, ev: Event): Promise<Message> {
  seq++;
  const base = { v: 1 as const, id: crypto.randomUUID(), from: id.name, kind: "event" as const, body: "", ts: 1_700_000_000_000 + seq, ev };
  const p = await sign(id, base);
  return { ...p, seq, rts: base.ts, sigOk: await verify(p) };
}

describe("fold", () => {
  let owner: Identity, ann: Identity;
  beforeAll(async () => void ([owner, ann] = await Promise.all([generateIdentity("human"), generateIdentity("ann")])));
  const roster = (laterRole?: Roster[number]["laterRole"]): Roster => [
    { name: "human", pk: owner.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "ann", pk: ann.pk, owner: false, at: 0, active: true, role: "intern", ...(laterRole ? { laterRole } : {}) },
  ];

  test("the role.set scrolled out of the loaded tail: the record's later role still holds", async () => {
    const set = await msg(owner, { op: "role.set", member: "ann", role: "backend", about: "relay only" });
    const tail = [await msg(ann, { op: "hello" })];
    expect(fold(tail, roster()).members.get("ann")?.persona?.name).toBe("intern");
    const s = fold(tail, roster({ role: "backend", about: "relay only", since: set.seq }));
    expect(s.members.get("ann")?.persona).toMatchObject({ name: "backend", role: "builder", instructions: "relay only" });
  });

  test("a role.set after the floor still wins, and the full log agrees with the floor", async () => {
    const set = await msg(owner, { op: "role.set", member: "ann", role: "backend" });
    const later = await msg(owner, { op: "role.set", member: "ann", role: "frontend" });
    const floor = { role: "backend", since: set.seq };
    expect(fold([later], roster(floor)).members.get("ann")?.persona?.name).toBe("frontend");
    expect(fold([set, later], roster(floor)).members.get("ann")?.persona?.name).toBe("frontend");
    expect(fold([set], roster(floor)).roleSets.get("ann")).toEqual({ seq: set.seq, role: "backend" });
  });

  test("the lead role comes through the floor too, and an old coordinator role reads as it", async () => {
    const set = await msg(owner, { op: "role.set", member: "ann", role: "coordinator" });
    const s = fold([await msg(ann, { op: "hello" })], roster({ role: "coordinator", since: set.seq }));
    expect(s.lead).toBe("ann");
  });
});

describe("the record", () => {
  test("carries the later role, signed; an owner's record never does; garbage reads as none", async () => {
    const [owner, ann] = await Promise.all([generateIdentity("human"), generateIdentity("ann")]);
    const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    const room = "ab".repeat(16);
    const seal = async (info: Parameters<typeof makeRecord>[2]) => sealRecord(key, await makeRecord(owner, room, info));
    const rec = await seal({ name: "ann", pk: ann.pk, xpk: ann.xpk!, laterRole: { role: "backend", about: null, since: 42 } });
    expect((await openRecord(key, rec, room, owner.pk, ann.pk))?.laterRole).toEqual({ role: "backend", about: null, since: 42 });
    const own = await seal({ name: "human", pk: owner.pk, xpk: owner.xpk!, owner: true, laterRole: { role: "x", since: 1 } });
    expect((await openRecord(key, own, room, owner.pk, owner.pk))?.laterRole).toBeUndefined();
    const bad = await seal({ name: "ann", pk: ann.pk, xpk: ann.xpk!, laterRole: { role: 7 as never, since: 1 } });
    expect((await openRecord(key, bad, room, owner.pk, ann.pk))?.laterRole).toBeUndefined();
  });
});

describe("over a relay", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "mc-role-floor-"));
  let server: ReturnType<typeof startRelay>;
  beforeAll(() => void (server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir })));
  afterAll(() => {
    server.stop(true);
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("the owner re-signs the record after a role.set, and a reconcile catches one that was missed", async () => {
    const relay = server.url.origin;
    const [human, ann] = await Promise.all([generateIdentity("human"), generateIdentity("ann")]);
    const { access, code } = await Channel.create(relay, human, { name: "human" });
    const owner = new Channel(access, relay, human);
    const req = await Channel.requestJoin(relay, code, ann, { name: "ann", role: "intern" });
    const mine = (await checked(owner, relay, code, [{ id: ann, requestId: req.requestId }])).find((r) => r.id === req.requestId)!;
    await owner.approve(mine);
    const annRec = () => owner.members().then((ms) => ms.find((m) => m.name === "ann")!);

    // A role.set whose record update never happened (an older owner client, a failed call).
    const set = await owner.send("made ann backend", { kind: "event", ev: { op: "role.set", member: "ann", role: "backend" } });
    expect((await annRec()).laterRole).toBeUndefined();
    const { messages } = await owner.history(0);
    const roster = (await owner.members()).map((m) => ({ ...m, at: m.at }));
    const changed = await owner.reconcilePosting(fold(messages, roster), await owner.members());
    expect(changed).toContain(ann.pk);
    expect((await annRec()).laterRole).toEqual({ role: "backend", since: set });
    // Nothing more to do the second time.
    expect(
      await owner.reconcilePosting(
        fold(
          messages,
          (await owner.members()).map((m) => ({ ...m })),
        ),
        await owner.members(),
      ),
    ).toEqual([]);
  });
});
