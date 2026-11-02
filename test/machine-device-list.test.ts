import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newRoomId } from "@kiwi/core/crypto.ts";
import { certUntil, checkDevice, nextLink, readDeviceList, rerootLink, rootLink, type DeviceLink, type DeviceLinkBody } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { recoveryKey, recoveryLink } from "@kiwi/core/recovery.ts";
import { loadMachine, newMachine, saveMachine, seatProof, takeDeviceList, type MachineFile } from "../src/machine.ts";

let home = "";
const prevHome = process.env.KIWI_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kiwi-machine-list-"));
  process.env.KIWI_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const key = async (name: string): Promise<Identity> => withExchangeKey(await generateIdentity(name));

async function grow(links: DeviceLink[], signer: Identity, body: DeviceLinkBody): Promise<DeviceLink[]> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return [...links, await nextLink(read.list, signer, body, Date.now())];
}

async function enrolled(): Promise<{ person: Identity; desk: Identity; m: MachineFile; links: DeviceLink[] }> {
  const person = await key("person");
  const desk = await key("desk");
  const m = await newMachine("https://relay.example");
  const root = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  const links = await grow(root, desk, { op: "add", device: m.identity.pk, dxpk: m.identity.xpk!, label: "box", os: "Linux", as: "computer", approve: false, until: certUntil(Date.now()) });
  saveMachine({ ...m, device: { person: { pk: person.pk, name: "jow", xpk: person.xpk! }, links } });
  return { person, desk, m, links };
}

test("a longer list of this computer's person, seen in a channel, replaces the kept one", async () => {
  const { desk, links } = await enrolled();
  const longer = await grow(links, desk, { op: "renew", device: loadMachine()!.identity.pk, until: certUntil(Date.now()) + 1000 });
  expect(await takeDeviceList(longer)).toBe("longer");
  expect(loadMachine()?.device?.links).toEqual(longer);
});

test("the same list, a shorter one, another person's or a forged one leaves machine.json alone", async () => {
  const { desk, links } = await enrolled();
  const longer = await grow(links, desk, { op: "renew", device: desk.pk, until: certUntil(Date.now()) });
  expect(await takeDeviceList(links)).toBeNull();
  expect(await takeDeviceList(links.slice(0, 1))).toBeNull();
  const other = await key("other");
  expect(await takeDeviceList([await rootLink(other, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })])).toBeNull();
  const forged = [...links, { ...longer[2]!, at: longer[2]!.at + 1 }];
  expect(await takeDeviceList(forged)).toBeNull();
  expect(await takeDeviceList("not a list")).toBeNull();
  expect(loadMachine()?.device?.links).toEqual(links);
});

test("a list that revokes this computer drops it from the person's devices, and keeps its key", async () => {
  const { desk, m, links } = await enrolled();
  const revoked = await grow(links, desk, { op: "revoke", device: m.identity.pk });
  expect(await takeDeviceList(revoked)).toBe("revoked");
  const after = loadMachine();
  expect(after?.device).toBeUndefined();
  expect(after?.identity.pk).toBe(m.identity.pk);
  expect(await takeDeviceList(revoked)).toBeNull();
});

test("a computer that never logged in ignores lists", async () => {
  saveMachine(await newMachine("https://relay.example"));
  const person = await key("person");
  const desk = await key("desk");
  expect(await takeDeviceList([await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })])).toBeNull();
});

async function rerooted(person: Identity, links: DeviceLink[], keep: string[]): Promise<DeviceLink[]> {
  const paper = await recoveryKey(new Uint8Array(32).fill(31));
  const chain = [await recoveryLink(person, person.pk, null, { pk: paper.pk, xpk: paper.xpk! })];
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return [...links, await rerootLink(read.list, paper, chain, await key("next"), keep)];
}

test("once its person re-roots and keeps it, this computer vouches for its agents' seats; before that, or once dropped, it doesn't (#1519)", async () => {
  const roomId = newRoomId();
  const agent = await key("agent");
  const { person, desk, m, links } = await enrolled();
  expect(await seatProof(roomId, agent.pk)).toBeNull();
  const kept = await rerooted(person, links, [desk.pk, m.identity.pk]);
  expect(await takeDeviceList(kept)).toBe("longer");
  const proof = await seatProof(roomId, agent.pk);
  expect(proof).toMatchObject({ links: kept, device: m.identity.pk, version: kept.length });
  expect(await checkDevice(proof, roomId, agent.pk)).toMatchObject({ person: person.pk, device: { device: m.identity.pk, as: "computer" } });
  expect(await checkDevice(proof, roomId, (await key("other")).pk)).toBeNull();

  const again = await enrolled();
  expect(await takeDeviceList(await rerooted(again.person, again.links, [again.desk.pk]))).toBe("revoked");
  expect(await seatProof(roomId, agent.pk)).toBeNull();
});
