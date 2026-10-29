import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { certUntil, claimDevice, newestLists, nextLink, readDeviceList, rerootLink, rootLink, type DeviceLink, type DeviceList } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { claimComputer, provePerson } from "@kiwi/core/person.ts";
import { recoveryKey, recoveryLink } from "@kiwi/core/recovery.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, joinPerson, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-device-claims-"));
let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const device = async (name: string) => withExchangeKey(await generateIdentity(name));

async function grow(links: DeviceLink[], signer: Identity, body: Parameters<typeof nextLink>[2], at = Date.now()): Promise<DeviceLink[]> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return [...links, await nextLink(read.list, signer, body, at)];
}

async function listOf(links: DeviceLink[]): Promise<DeviceList> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return read.list;
}

async function listWithPhone(person: Identity): Promise<{ links: DeviceLink[]; desk: Identity; phone: Identity }> {
  const desk = await device("desk");
  const phone = await device("phone");
  const root = await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" });
  const links = await grow([root], desk, { op: "add", device: phone.pk, dxpk: phone.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) });
  return { links, desk, phone };
}

async function ask(s: OwnerSetup, phone: Identity, links: DeviceLink[], name: string) {
  const id = await generateIdentity(name);
  const { requestId } = await Channel.requestJoin(relay, s.code, id, { name }, { device: await claimDevice(phone, links, s.roomId, id.pk) });
  return { id, requestId };
}

async function letThrough(s: OwnerSetup, joiner: { id: Identity; requestId: string }) {
  await s.ownerCh.autoApprove(s.person.pk);
  await Channel.joinStatus(relay, s.code, joiner.id, joiner.requestId);
  return s.ownerCh.autoApprove(s.person.pk);
}

describe("a person's other devices join as them (T634)", () => {
  test("the owner's phone joins on its own, as the owner's person without the owner key", async () => {
    const s = await setupChannel(relay);
    const { links, phone } = await listWithPhone(s.person);
    const joiner = await ask(s, phone, links, "owner");
    const req = (await s.ownerCh.requests({ person: s.person.pk })).find((r) => r.id === joiner.requestId);
    expect(req).toMatchObject({ kind: "human", device: { person: s.person.pk, label: "phone", as: "phone", own: true, joinsOnItsOwn: true, handle: "owner" } });

    const approved = await letThrough(s, joiner);
    expect(approved).toHaveLength(1);
    const member = (await s.ownerCh.members()).find((m) => m.pk === joiner.id.pk);
    expect(member).toMatchObject({ name: "owner-2", kind: "human", owner: false, person: s.person.pk, device: { label: "phone", as: "phone" }, addsAgents: true, answersDecisions: true });
    expect(member?.sponsor).toMatchObject({ user: s.person.pk, handle: "owner" });
    expect((await Channel.joinStatus(relay, s.code, joiner.id, joiner.requestId)).status).toBe("approved");
    await s.ownerCh.close();
  });

  test("the owner's phone joins on its own in a channel the app made, whose owner record has no person key", async () => {
    const s = await setupChannel(relay, { personInRecord: false });
    const { links, phone } = await listWithPhone(s.person);
    const joiner = await ask(s, phone, links, "owner");
    const req = (await s.ownerCh.requests({ person: s.person.pk })).find((r) => r.id === joiner.requestId);
    expect(req).toMatchObject({ kind: "human", device: { person: s.person.pk, own: true, joinsOnItsOwn: true, handle: "owner" } });

    expect(await letThrough(s, joiner)).toHaveLength(1);
    const member = (await s.ownerCh.members()).find((m) => m.pk === joiner.id.pk);
    expect(member).toMatchObject({ name: "owner-2", kind: "human", owner: false, person: s.person.pk, device: { as: "phone" }, addsAgents: true, answersDecisions: true });
    expect(member?.sponsor).toMatchObject({ user: s.person.pk, handle: "owner" });
    await s.ownerCh.close();
  });

  test("a member's phone joins on its own, with no more than that member may do", async () => {
    const s = await setupChannel(relay);
    const bobsPerson = await generateIdentity("bobs-person");
    const bob = await joinPerson(s, "bob", bobsPerson, { scopes: ["post"], answersDecisions: true });
    const { links, phone } = await listWithPhone(bobsPerson);
    const joiner = await ask(s, phone, links, "bob");

    expect((await letThrough(s, joiner)).map((m) => m.name)).toEqual(["bob-2"]);
    const member = (await s.ownerCh.members()).find((m) => m.pk === joiner.id.pk);
    expect(member).toMatchObject({ kind: "human", person: bobsPerson.pk, device: { as: "phone" }, answersDecisions: true, scopes: bob.member.scopes });
    expect(member?.addsAgents).toBeUndefined();
    await s.ownerCh.close();
  });

  test("a stranger's device waits for a person", async () => {
    const s = await setupChannel(relay);
    const stranger = await generateIdentity("stranger");
    const { links, phone } = await listWithPhone(stranger);
    const joiner = await ask(s, phone, links, "stranger");

    expect(await letThrough(s, joiner)).toEqual([]);
    const req = (await s.ownerCh.requests({ person: s.person.pk })).find((r) => r.id === joiner.requestId);
    expect(req).toMatchObject({ kind: "human", device: { person: stranger.pk, own: false, joinsOnItsOwn: false } });
    expect(req?.device?.handle).toBeUndefined();
    await s.ownerCh.close();
  });

  test("a revoked or expired device carries no claim, and waits", async () => {
    const s = await setupChannel(relay);
    const { links, desk, phone } = await listWithPhone(s.person);
    const revoked = await grow(links, desk, { op: "revoke", device: phone.pk });
    const gone = await ask(s, phone, revoked, "lost-phone");
    const late = await device("late");
    const then = Date.now() - 100 * 86_400_000;
    const stale = await grow(links, desk, { op: "add", device: late.pk, dxpk: late.xpk!, label: "late", os: "iOS", as: "phone", approve: false, until: certUntil(then) }, then);
    const expired = await ask(s, late, stale, "late-phone");

    expect(await letThrough(s, gone)).toEqual([]);
    const reqs = await s.ownerCh.requests({ person: s.person.pk });
    for (const id of [gone.requestId, expired.requestId]) expect(reqs.find((r) => r.id === id)?.device).toBeUndefined();
    await s.ownerCh.close();
  });

  test("a vouch for another member key doesn't carry over", async () => {
    const s = await setupChannel(relay);
    const { links, phone } = await listWithPhone(s.person);
    const id = await generateIdentity("swapped");
    const claim = await claimDevice(phone, links, s.roomId, (await generateIdentity("other")).pk);
    const { requestId } = await Channel.requestJoin(relay, s.code, id, { name: "swapped" }, { device: claim });
    expect((await s.ownerCh.requests({ person: s.person.pk })).find((r) => r.id === requestId)?.device).toBeUndefined();
    await s.ownerCh.close();
  });
});

describe("a revoked device is cut out, and the newest list decides (T641)", () => {
  test("the owner removes a revoked phone and a revoked computer's agents, in one rotation", async () => {
    const s = await setupChannel(relay);
    const { links, desk, phone } = await listWithPhone(s.person);
    const box = await device("box");
    const all = await grow(links, desk, { op: "add", device: box.pk, dxpk: box.xpk!, label: "box", os: "Linux", as: "computer", approve: false, until: certUntil(Date.now()) });
    const onPhone = await ask(s, phone, all, "owner");
    expect(await letThrough(s, onPhone)).toHaveLength(1);
    const agent = await ask(s, box, all, "builder");
    expect(await letThrough(s, agent)).toHaveLength(1);
    const members = await s.ownerCh.members();
    expect(members.find((m) => m.pk === onPhone.id.pk)?.device).toEqual({ pk: phone.pk, label: "phone", as: "phone" });
    expect(members.find((m) => m.pk === agent.id.pk)?.from?.pk).toBe(box.pk);

    const stranger = await generateIdentity("stranger");
    const theirs = await device("their-desk");
    let fake = [await rootLink(stranger, { pk: theirs.pk, xpk: theirs.xpk!, label: "desk", os: "macOS", as: "desktop" })];
    fake = await grow(fake, theirs, { op: "add", device: phone.pk, dxpk: phone.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) });
    fake = await grow(fake, theirs, { op: "revoke", device: phone.pk });
    expect(await s.ownerCh.cutDevices(await listOf(fake))).toEqual([]);

    const epoch = s.ownerCh.access.epoch;
    const revoked = await grow(await grow(all, desk, { op: "revoke", device: phone.pk }), desk, { op: "revoke", device: box.pk });
    expect((await s.ownerCh.cutDevices(await listOf(revoked))).map((m) => m.name).sort()).toEqual(["builder", "owner-2"]);
    expect(s.ownerCh.access.epoch).toBe(epoch + 1);
    const active = (await s.ownerCh.members()).filter((m) => m.active).map((m) => m.pk);
    expect(active).not.toContain(onPhone.id.pk);
    expect(active).not.toContain(agent.id.pk);
    expect(await s.ownerCh.cutDevices(await listOf(revoked))).toEqual([]);
    expect(s.ownerCh.access.epoch).toBe(epoch + 1);
    await s.ownerCh.close();
  });

  test("a claim made before a revoke waits, and one made before a renewal joins", async () => {
    const s = await setupChannel(relay);
    const { links, desk, phone } = await listWithPhone(s.person);
    const stolen = await ask(s, phone, links, "owner");
    const late = await device("late");
    const then = Date.now() - 100 * 86_400_000;
    const stale = await grow(links, desk, { op: "add", device: late.pk, dxpk: late.xpk!, label: "late", os: "iOS", as: "phone", approve: false, until: certUntil(then) }, then);
    const lapsed = await ask(s, late, stale, "late-phone");
    const newer = await grow(await grow(stale, desk, { op: "revoke", device: phone.pk }), desk, { op: "renew", device: late.pk, until: certUntil(Date.now()) });
    const lists = new Map([[s.person.pk, await listOf(newer)]]);

    const reqs = await s.ownerCh.requests({ person: s.person.pk, lists });
    expect(reqs.find((r) => r.id === stolen.requestId)?.device).toBeUndefined();
    expect(reqs.find((r) => r.id === lapsed.requestId)?.device).toMatchObject({ pk: late.pk, joinsOnItsOwn: true });
    await s.ownerCh.autoApprove(s.person.pk, [], null, lists);
    await Channel.joinStatus(relay, s.code, lapsed.id, lapsed.requestId);
    expect((await s.ownerCh.autoApprove(s.person.pk, [], null, lists)).map((m) => m.name)).toEqual(["owner-2"]);
    await s.ownerCh.close();
  });
});

describe("a member's list posted into the channel cuts their forgotten phone (T1006)", () => {
  test("bob's desktop posts the revoke, and the owner reads it from the log and cuts bob's phone", async () => {
    const s = await setupChannel(relay);
    const bobsPerson = await generateIdentity("bobs-person");
    const bob = await joinPerson(s, "bob", bobsPerson, { scopes: ["post"] });
    const { links, desk, phone } = await listWithPhone(bobsPerson);
    const joiner = await ask(s, phone, links, "bob");
    expect((await letThrough(s, joiner)).map((m) => m.name)).toEqual(["bob-2"]);

    const revoked = await grow(links, desk, { op: "revoke", device: phone.pk });
    await bob.ch.send("updated their list of devices", { kind: "event", ev: { op: "devices", links: revoked } });
    const posted = (await s.ownerCh.history(0)).messages.flatMap((m) => (m.kind === "event" && m.ev?.op === "devices" ? [m.ev.links] : []));
    const lists = await newestLists(posted);
    expect(lists.get(bobsPerson.pk)?.revoked).toEqual([phone.pk]);
    expect((await s.ownerCh.cutDevices(lists.get(bobsPerson.pk)!)).map((m) => m.name)).toEqual(["bob-2"]);
    expect((await s.ownerCh.members()).find((m) => m.pk === joiner.id.pk)?.active).toBe(false);
    await s.ownerCh.close();
  });
});

describe("a re-root cuts what the old person key vouched for (T827)", () => {
  test("the owner cuts the devices left out and the computers only an old cert vouched for, and old-key claims stop counting", async () => {
    const s = await setupChannel(relay);
    const { links, desk, phone } = await listWithPhone(s.person);
    const box = await device("box");
    const all = await grow(links, desk, { op: "add", device: box.pk, dxpk: box.xpk!, label: "box", os: "Linux", as: "computer", approve: false, until: certUntil(Date.now()) });
    const onPhone = await ask(s, phone, all, "owner");
    expect(await letThrough(s, onPhone)).toHaveLength(1);
    const listed = await ask(s, box, all, "listed");
    expect(await letThrough(s, listed)).toHaveLength(1);
    const certified = await joinAgent(s, "certified", await pairComputer(s.person));
    expect(certified.member.sponsor?.user).toBe(s.person.pk);

    const paper = await recoveryKey(new Uint8Array(32).fill(21));
    const chain = [await recoveryLink(s.person, s.person.pk, null, { pk: paper.pk, xpk: paper.xpk! })];
    const next = await device("next");
    const rerooted = await listOf([...all, await rerootLink(await listOf(all), paper, chain, next, [desk.pk, box.pk])]);
    expect(rerooted.revoked).toEqual([phone.pk]);
    expect((await s.ownerCh.cutDevices(rerooted)).map((m) => m.name).sort()).toEqual(["certified", "owner-2"]);
    const active = (await s.ownerCh.members()).filter((m) => m.active).map((m) => m.name);
    expect(active).toContain("listed");
    expect(active).not.toContain("certified");

    const lists = new Map([[s.person.pk, rerooted]]);
    const again = await generateIdentity("again");
    const stolen = await pairComputer(s.person);
    const byCert = await Channel.requestJoin(relay, s.code, again, { name: "again" }, { computer: await claimComputer(stolen.machine, stolen.cert, s.roomId, again.pk) });
    const me = await generateIdentity("me");
    const byPerson = await Channel.requestJoin(relay, s.code, me, { name: "me" }, { person: await provePerson(s.person, s.roomId, me.pk) });
    const reqs = await s.ownerCh.requests({ person: s.person.pk, lists });
    expect(reqs.find((r) => r.id === byPerson.requestId)?.person).toBeUndefined();
    expect(reqs.find((r) => r.id === byCert.requestId)?.computer).toBeUndefined();
    const before = await s.ownerCh.requests({ person: s.person.pk });
    expect(before.find((r) => r.id === byPerson.requestId)?.person).toBe(s.person.pk);
    await s.ownerCh.close();
  });
});
