import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { admitOwn } from "@kiwi/core/client/delegate.ts";
import { wrapAllFor } from "@kiwi/core/client/keys.ts";
import { DELEGATION_DAYS, delegatedMember, makeDelegation, readDelegation } from "@kiwi/core/delegation.ts";
import { generateIdentity, sign, type Identity } from "@kiwi/core/identity.ts";
import { makeRecord, sealRecord, type Member, type MemberInfo } from "@kiwi/core/membership.ts";
import { omit } from "@kiwi/core/omit.ts";
import { claimComputer } from "@kiwi/core/person.ts";
import { startRelay } from "../src/relay/bun.ts";
import { pairComputer, setupChannel, type OwnerSetup, type PairedComputer } from "./owner.ts";

setDefaultTimeout(30_000);

const DAY_MS = 86_400_000;
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-delegation-"));
let skew = 0;
let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, now: () => Date.now() + skew });
  relay = server.url.origin;
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function ask(s: OwnerSetup, name: string, computer: PairedComputer): Promise<{ id: Identity; requestId: string }> {
  const id = await generateIdentity(name);
  const claim = await claimComputer(computer.machine, computer.cert, s.roomId, id.pk);
  const { requestId } = await Channel.requestJoin(relay, s.code, id, { name }, { computer: claim });
  return { id, requestId };
}

async function call(s: OwnerSetup, as: Identity, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const query = method === "GET" && path === "/requests" ? "?v=2" : "";
  const res = await fetch(`${relay}/v1/rooms/${s.roomId}${path}${query}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${await signRequest(as, s.roomId, method, path + query, text)}` },
    body: text || undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function delegated(name = "mac-mini"): Promise<{ s: OwnerSetup; pc: PairedComputer }> {
  const s = await setupChannel(relay);
  const pc = await pairComputer(s.person, name);
  await s.ownerCh.delegate({ pk: pc.machine.pk, xpk: pc.machine.xpk! }, s.person.pk);
  return { s, pc };
}

async function letIn(s: OwnerSetup, pc: PairedComputer, name: string): Promise<{ id: Identity; ch: Channel; admitted: Member[] }> {
  const { id, requestId } = await ask(s, name, pc);
  expect(await admitOwn(relay, s.roomId, s.owner.pk, pc.machine)).toEqual({ admitted: [], waiting: 1 });
  const pending = await Channel.joinStatus(relay, s.code, id, requestId);
  expect(pending).toMatchObject({ status: "pending" });
  const { admitted, waiting } = await admitOwn(relay, s.roomId, s.owner.pk, pc.machine);
  expect(waiting).toBe(0);
  const st = await Channel.joinStatus(relay, s.code, id, requestId);
  if (st.status !== "approved") throw new Error(`not let in: ${st.status}`);
  return { id, ch: new Channel(st.access, relay, id), admitted };
}

describe("a delegation is the owner's word, and nothing else's", () => {
  test("only the owner's signature, for this room and scope, within 14 days, with no extra fields, reads as one", async () => {
    const owner = await generateIdentity("owner");
    const stranger = await generateIdentity("eve");
    const device = await generateIdentity("machine");
    const person = await generateIdentity("person");
    const d = await makeDelegation(owner, "room-1", { pk: device.pk, xpk: device.xpk! }, person.pk);
    expect(await readDelegation(d, "room-1", owner.pk)).toEqual(d);
    expect(await readDelegation(JSON.stringify(d), "room-1", owner.pk)).toEqual(d);
    expect(await readDelegation(d, "room-2", owner.pk)).toBeNull();
    expect(await readDelegation(await makeDelegation(stranger, "room-1", { pk: device.pk, xpk: device.xpk! }, person.pk), "room-1", owner.pk)).toBeNull();
    expect(await readDelegation({ ...d, until: d.until + DAY_MS }, "room-1", owner.pk)).toBeNull();
    expect(await readDelegation({ ...d, delegate: stranger.pk }, "room-1", owner.pk)).toBeNull();
    const body = omit(d, "pk", "sig");
    expect(await readDelegation(await sign(owner, { ...body, scope: "everything" }), "room-1", owner.pk)).toBeNull();
    expect(await readDelegation(await sign(owner, { ...body, extra: true }), "room-1", owner.pk)).toBeNull();
    expect(await readDelegation(await sign(owner, { ...body, until: body.at + (DELEGATION_DAYS + 1) * DAY_MS }), "room-1", owner.pk)).toBeNull();
    expect(await readDelegation("not json", "room-1", owner.pk)).toBeNull();
  });

  test("a record it signed counts only for its own agent, made while it lasted", async () => {
    const owner = await generateIdentity("owner");
    const device = await generateIdentity("machine");
    const person = await generateIdentity("person");
    const d = await makeDelegation(owner, "room-1", { pk: device.pk, xpk: device.xpk! }, person.pk);
    const member: Member = {
      name: "helper",
      pk: "x",
      xpk: "y",
      kind: "agent",
      owner: false,
      at: d.at + 1,
      active: true,
      from: { pk: device.pk, label: "mac" },
      sponsor: { user: person.pk, name: "Jo" },
    };
    const fields = ["room", "member", "mxpk", "name", "kind", "sponsor", "from", "at", "pk", "sig"];
    expect(delegatedMember({ member, signer: device.pk, fields }, d)).toBe(true);
    expect(delegatedMember({ member: { ...member, at: d.until }, signer: device.pk, fields }, d)).toBe(false);
    expect(delegatedMember({ member: { ...member, at: d.at - 60_000 }, signer: device.pk, fields }, d)).toBe(true);
    expect(delegatedMember({ member: { ...member, at: d.at - DAY_MS }, signer: device.pk, fields }, d)).toBe(false);
    expect(delegatedMember({ member, signer: owner.pk, fields }, d)).toBe(false);
    expect(delegatedMember({ member, signer: device.pk, fields: [...fields, "role"] }, d)).toBe(false);
    expect(delegatedMember({ member: { ...member, kind: "human" }, signer: device.pk, fields }, d)).toBe(false);
    expect(delegatedMember({ member: { ...member, from: { pk: owner.pk, label: "other" } }, signer: device.pk, fields }, d)).toBe(false);
    expect(delegatedMember({ member: { ...member, sponsor: { user: owner.pk, name: "Eve" } }, signer: device.pk, fields }, d)).toBe(false);
  });
});

describe("the daemon admits its own computer's agents with the app closed (T677)", () => {
  test("its agent joins on its own, and every member sees it verified", async () => {
    const { s, pc } = await delegated();
    const { id, ch, admitted } = await letIn(s, pc, "helper");
    expect(admitted.map((m) => m.name)).toEqual(["helper"]);
    const seen = (await ch.members()).find((m) => m.pk === id.pk);
    expect(seen).toMatchObject({ name: "helper", kind: "agent", from: { pk: pc.machine.pk, label: "mac-mini" }, signedBy: pc.machine.pk, sponsor: { user: s.person.pk } });
    expect(seen?.unverified).toBeUndefined();
    expect((await s.ownerCh.members()).find((m) => m.pk === id.pk)?.unverified).toBeUndefined();
    await ch.send("hello from the daemon's agent");
    const { messages } = await s.ownerCh.history(0);
    expect(messages.some((m) => m.from === "helper")).toBe(true);
    await s.ownerCh.close();
  });

  test("a rotation re-wraps the new key to the delegate, so it keeps admitting", async () => {
    const { s, pc } = await delegated();
    await letIn(s, pc, "first");
    await s.ownerCh.rotate();
    const { ch, admitted } = await letIn(s, pc, "second");
    expect(admitted.map((m) => m.name)).toEqual(["second"]);
    expect(Object.keys(ch.access.keys).sort()).toEqual(["0", "1"]);
    await s.ownerCh.close();
  });

  test("a taken name gets a free one, never the seat", async () => {
    const { s, pc } = await delegated();
    await letIn(s, pc, "helper");
    const { admitted } = await letIn(s, pc, "helper");
    expect(admitted[0]?.name).not.toBe("helper");
    await s.ownerCh.close();
  });

  test("it never sees or admits another computer's agents", async () => {
    const { s, pc } = await delegated();
    const other = await pairComputer(s.person, "vps-1");
    const { id, requestId } = await ask(s, "stray", other);
    await s.ownerCh.requests({ person: s.person.pk });
    expect(await admitOwn(relay, s.roomId, s.owner.pk, pc.machine)).toEqual({ admitted: [], waiting: 0 });
    expect(((await call(s, pc.machine, "GET", "/requests")).json as { requests: unknown[] }).requests).toEqual([]);
    expect((await call(s, pc.machine, "POST", `/requests/${requestId}/nonce`, { nonce: "x" })).status).toBe(404);
    await Channel.joinStatus(relay, s.code, id, requestId);
    const rec = await sealRecord(
      s.access.keys["0"]!,
      await makeRecord(pc.machine, s.roomId, { name: "stray", kind: "agent", pk: id.pk, xpk: id.xpk!, from: { pk: pc.machine.pk, label: "mac-mini" } }),
    );
    const keys = await wrapAllFor(pc.machine, s.roomId, s.access.keys, id.pk, id.xpk!);
    expect((await call(s, pc.machine, "POST", "/members", { pk: id.pk, xpk: id.xpk, rec, keys, request: requestId })).status).toBe(400);
    await s.ownerCh.close();
  });

  test("a record that claims more than an own agent reads as unverified", async () => {
    const overreach: [string, Partial<MemberInfo>][] = [
      ["a person", { kind: "human" }],
      ["a role", { role: "coordinator" }],
      ["another computer", { from: { pk: "A".repeat(43), label: "elsewhere" } }],
      ["another sponsor", { sponsor: { user: "B".repeat(43), name: "Eve" } }],
      ["a person key", { person: "C".repeat(43) }],
    ];
    const { s, pc } = await delegated();
    for (const [what, extra] of overreach) {
      const { id, requestId } = await ask(s, `agent-${overreach.findIndex(([w]) => w === what)}`, pc);
      await admitOwn(relay, s.roomId, s.owner.pk, pc.machine);
      await Channel.joinStatus(relay, s.code, id, requestId);
      const info: MemberInfo = {
        name: `bad-${id.pk.slice(0, 4).replace(/[^A-Za-z0-9]/g, "x")}`,
        kind: "agent",
        sponsor: { user: s.person.pk, name: "owner" },
        from: { pk: pc.machine.pk, label: "mac-mini" },
        ...extra,
      };
      const rec = await sealRecord(s.access.keys["0"]!, await makeRecord(pc.machine, s.roomId, { ...info, pk: id.pk, xpk: id.xpk! }));
      const keys = await wrapAllFor(pc.machine, s.roomId, s.access.keys, id.pk, id.xpk!);
      expect((await call(s, pc.machine, "POST", "/members", { pk: id.pk, xpk: id.xpk, rec, keys, request: requestId })).status).toBe(200);
      const seen = (await s.ownerCh.members()).find((m) => m.pk === id.pk);
      expect([what, seen?.unverified]).toEqual([what, true]);
    }
    await s.ownerCh.close();
  });
});

describe("the owner's app keeps its computers' delegations (T684)", () => {
  test("it delegates to each computer, renews one under 7 days left, and leaves a fresh one alone", async () => {
    const s = await setupChannel(relay);
    const pc = await pairComputer(s.person, "mac-mini");
    const mine = [{ pk: pc.machine.pk, xpk: pc.machine.xpk! }];
    expect(await s.ownerCh.tendDelegations(mine, s.person.pk)).toEqual({ issued: [pc.machine.pk], dropped: [], adopted: [] });
    expect(await s.ownerCh.tendDelegations(mine, s.person.pk)).toEqual({ issued: [], dropped: [], adopted: [] });
    const old = await makeDelegation(s.owner, s.roomId, mine[0]!, s.person.pk, Date.now() - 8 * DAY_MS);
    const keys = await wrapAllFor(s.owner, s.roomId, s.ownerCh.access.keys, pc.machine.pk, pc.machine.xpk!);
    expect((await call(s, s.owner, "PUT", "/delegations", { d: old, keys })).status).toBe(200);
    expect((await s.ownerCh.delegations())[0]?.until).toBe(old.until);
    expect((await s.ownerCh.tendDelegations(mine, s.person.pk)).issued).toEqual([pc.machine.pk]);
    expect((await s.ownerCh.delegations())[0]!.until).toBeGreaterThan(Date.now() + 13 * DAY_MS);
    await s.ownerCh.close();
  });

  test("a computer no longer listed loses its delegation and every later key", async () => {
    const { s, pc } = await delegated();
    expect(await s.ownerCh.tendDelegations([], s.person.pk)).toEqual({ issued: [], dropped: [pc.machine.pk], adopted: [] });
    expect(await s.ownerCh.delegations()).toEqual([]);
    expect(s.ownerCh.access.epoch).toBe(1);
    expect((await call(s, pc.machine, "GET", "/delegation")).status).toBe(404);
    expect(await s.ownerCh.dropDelegates([pc.machine.pk])).toEqual([]);
    expect(s.ownerCh.access.epoch).toBe(1);
    await s.ownerCh.close();
  });

  test("forgetting a computer drops its delegation and rotates, and only that one", async () => {
    const { s, pc } = await delegated();
    const other = await pairComputer(s.person, "laptop");
    await s.ownerCh.delegate({ pk: other.machine.pk, xpk: other.machine.xpk! }, s.person.pk);
    expect(await s.ownerCh.dropDelegates([pc.machine.pk])).toEqual([pc.machine.pk]);
    expect((await s.ownerCh.delegations()).map((d) => d.delegate)).toEqual([other.machine.pk]);
    expect(s.ownerCh.access.epoch).toBe(1);
    const { admitted } = await letIn(s, other, "still-works");
    expect(admitted.map((m) => m.name)).toEqual(["still-works"]);
    await s.ownerCh.close();
  });

  test("an agent its delegate let in is re-signed by the owner, and keeps working", async () => {
    const { s, pc } = await delegated();
    const { id, ch } = await letIn(s, pc, "helper");
    const mine = [{ pk: pc.machine.pk, xpk: pc.machine.xpk! }];
    expect(await s.ownerCh.tendDelegations(mine, s.person.pk)).toEqual({ issued: [], dropped: [], adopted: [id.pk] });
    const seen = (await ch.members()).find((m) => m.pk === id.pk);
    expect(seen).toMatchObject({ name: "helper", kind: "agent", from: { pk: pc.machine.pk }, sponsor: { user: s.person.pk } });
    expect(seen?.signedBy).toBeUndefined();
    expect(seen?.unverified).toBeUndefined();
    expect((await s.ownerCh.tendDelegations(mine, s.person.pk)).adopted).toEqual([]);
    await ch.send("still here");
    const { messages } = await s.ownerCh.history(0);
    expect(messages.some((m) => m.from === "helper" && m.body === "still here")).toBe(true);
    await s.ownerCh.close();
  });
});

describe("revoking and expiry stop a delegate at once", () => {
  test("after the owner drops it, the relay refuses the delegate and nobody else is admitted", async () => {
    const { s, pc } = await delegated();
    const { id, requestId } = await ask(s, "late", pc);
    await s.ownerCh.undelegate(pc.machine.pk);
    expect(await s.ownerCh.delegations()).toEqual([]);
    expect(await admitOwn(relay, s.roomId, s.owner.pk, pc.machine)).toEqual({ admitted: [], waiting: 0 });
    expect((await call(s, pc.machine, "GET", "/delegation")).status).toBe(404);
    expect((await call(s, pc.machine, "GET", "/requests")).status).toBe(404);
    expect((await call(s, pc.machine, "POST", `/requests/${requestId}/nonce`, { nonce: "x" })).status).toBe(404);
    expect((await call(s, pc.machine, "GET", "/members")).status).toBe(404);
    expect(await Channel.joinStatus(relay, s.code, id, requestId)).toEqual({ status: "pending", code: null });
    await s.ownerCh.close();
  });

  test("past its 14 days the relay treats it as gone; the agents it let in stay", async () => {
    const { s, pc } = await delegated();
    const { id: kept } = await letIn(s, pc, "kept");
    const { id, requestId } = await ask(s, "late", pc);
    skew = (DELEGATION_DAYS + 1) * DAY_MS;
    try {
      expect(await admitOwn(relay, s.roomId, s.owner.pk, pc.machine)).toEqual({ admitted: [], waiting: 0 });
      expect((await call(s, pc.machine, "POST", `/requests/${requestId}/nonce`, { nonce: "x" })).status).toBe(404);
      expect((await call(s, pc.machine, "GET", "/delegation")).status).toBe(404);
    } finally {
      skew = 0;
    }
    expect(await Channel.joinStatus(relay, s.code, id, requestId)).toEqual({ status: "pending", code: null });
    expect((await s.ownerCh.members()).find((m) => m.pk === kept.pk)?.unverified).toBeUndefined();
    await s.ownerCh.close();
  });

  test("the relay takes no stale, forged or stranger's delegation", async () => {
    const s = await setupChannel(relay);
    const pc = await pairComputer(s.person);
    const stranger = await generateIdentity("eve");
    const device = { pk: pc.machine.pk, xpk: pc.machine.xpk! };
    const keys = await wrapAllFor(s.owner, s.roomId, s.access.keys, device.pk, device.xpk);
    const stale = await makeDelegation(s.owner, s.roomId, device, s.person.pk, Date.now() - (DELEGATION_DAYS + 1) * DAY_MS);
    expect((await call(s, s.owner, "PUT", "/delegations", { d: stale, keys })).status).toBe(400);
    const forged = await makeDelegation(stranger, s.roomId, device, s.person.pk);
    expect((await call(s, s.owner, "PUT", "/delegations", { d: { ...forged, pk: s.owner.pk }, keys })).status).toBe(400);
    expect((await call(s, s.owner, "PUT", "/delegations", { d: forged, keys })).status).toBe(400);
    const good = await makeDelegation(s.owner, s.roomId, device, s.person.pk);
    expect((await call(s, stranger, "PUT", "/delegations", { d: good, keys })).status).toBe(404);
    expect((await call(s, s.owner, "PUT", "/delegations", { d: good, keys: {} })).status).toBe(400);
    expect((await call(s, stranger, "GET", "/requests")).status).toBe(404);
    expect((await call(s, stranger, "POST", "/members", {})).status).toBe(404);
    expect((await call(s, stranger, "DELETE", `/delegations/${pc.machine.pk}`)).status).toBe(404);
    await s.ownerCh.close();
  });

  test("a closed channel answers its delegate as gone, like its members", async () => {
    const { s, pc } = await delegated();
    await s.ownerCh.close();
    for (const [method, path] of [
      ["GET", "/delegation"],
      ["GET", "/members"],
      ["GET", "/requests"],
    ] as const) {
      expect([path, (await call(s, pc.machine, method, path)).json]).toEqual([path, expect.objectContaining({ tag: "ChannelGone" })]);
    }
  });
});
