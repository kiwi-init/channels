import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { certUntil, claimDevice, nextLink, readDeviceList, rootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinPerson, setupChannel, type OwnerSetup } from "./owner.ts";

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
