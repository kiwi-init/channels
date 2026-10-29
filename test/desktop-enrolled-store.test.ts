import { expect, test } from "bun:test";
import { encodeJoinCode, newRoomId, ownerFingerprint } from "@kiwi/core/crypto.ts";
import { checkDevice, rootLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey } from "@kiwi/core/identity.ts";
import { useHost } from "../desktop/src/host.ts";
import { devicesCalls, storeDeviceHost } from "../desktop/src/ipc/devices.ts";
import { answerKeys, type KeysAnswer } from "../desktop/src/keys-host.ts";
import { mutate, openStore, requirePerson, snapshot, store, type StoreFile } from "../desktop/src/store.ts";
import { fakeHost } from "./fake-host.ts";

const { host, told } = fakeHost();
useHost(host);

async function enrolledStore() {
  const person = await withExchangeKey(await generateIdentity("Jow"));
  const device = await withExchangeKey(await generateIdentity("studio"));
  const links = [await rootLink(person, { pk: device.pk, xpk: device.xpk!, label: "studio", os: "Linux", as: "desktop" })];
  const file: Partial<StoreFile> = { enrolled: { name: "Jow", pk: person.pk, xpk: person.xpk! }, device, deviceLinks: links };
  openStore({ where: () => "/data/kiwi-store.bin", load: () => ({ ok: true, file, resave: false }), save: () => {} });
  return { person, device };
}

const asked = (m: Parameters<typeof answerKeys>[0]) => new Promise<KeysAnswer>((done) => answerKeys(m, (extra) => done(extra ?? {})));

test("an enrolled desktop shows its person and proves joins with a device claim, not a person claim (T837)", async () => {
  const { person, device } = await enrolledStore();
  expect(snapshot().person).toEqual({ name: "Jow", pk: person.pk, xpk: person.xpk! });
  const roomId = newRoomId();
  const code = encodeJoinCode({ roomId, ownerFp: await ownerFingerprint(person.pk) });
  const member = await generateIdentity("jow");
  const { claim } = await asked({ type: "prove", id: 1, code, memberPk: member.pk });
  expect(claim?.person).toBeUndefined();
  expect(await checkDevice(claim?.device, roomId, member.pk)).toMatchObject({ person: person.pk, device: { device: device.pk, as: "desktop" } });
});

test("an enrolled desktop refuses what only the person key does, and still tells the keys process whose it is", async () => {
  const { person } = await enrolledStore();
  expect(() => requirePerson()).toThrow("signed in as one of your devices");
  mutate((s) => (s.pending = []));
  expect(told.at(-1)).toMatchObject({ type: "seats", person: person.pk });
});

test("the app holding the person key proves joins with its device claim too, never the person key's own (T899)", async () => {
  const person = await withExchangeKey(await generateIdentity("Jow"));
  const device = await withExchangeKey(await generateIdentity("desk"));
  const links = [await rootLink(person, { pk: device.pk, xpk: device.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  const held = { name: "Jow", pk: person.pk, sk: person.sk, xpk: person.xpk!, xsk: person.xsk! };
  openStore({ where: () => "/data/kiwi-store.bin", load: () => ({ ok: true, file: { person: held, device, deviceLinks: links }, resave: false }), save: () => {} });
  const roomId = newRoomId();
  const code = encodeJoinCode({ roomId, ownerFp: await ownerFingerprint(person.pk) });
  const member = await generateIdentity("jow");
  const { claim } = await asked({ type: "prove", id: 2, code, memberPk: member.pk });
  expect(claim?.person).toBeUndefined();
  expect(await checkDevice(claim?.device, roomId, member.pk)).toMatchObject({ person: person.pk, device: { device: device.pk } });
  openStore({ where: () => "/data/kiwi-store.bin", load: () => ({ ok: true, file: { person: held }, resave: false }), save: () => {} });
  expect((await asked({ type: "prove", id: 3, code, memberPk: member.pk })).claim).toBeNull();
});

test("the desktop vouches for its own seat in a channel with its device key, and for nothing it hasn't joined (T967)", async () => {
  const { person, device } = await enrolledStore();
  const roomId = newRoomId();
  const code = encodeJoinCode({ roomId, ownerFp: await ownerFingerprint(person.pk) });
  const seat = await generateIdentity("jow");
  mutate((s) => (s.channels = [{ label: "kiwi", pk: seat.pk, sk: seat.sk, code, access: { roomId } }]));
  const calls = devicesCalls(storeDeviceHost());
  const proof = await calls.proveSeat(code);
  expect(proof?.device).toBe(device.pk);
  expect(await checkDevice({ links: store.deviceLinks, ...proof }, roomId, seat.pk)).toMatchObject({ person: person.pk, device: { device: device.pk } });
  const other = encodeJoinCode({ roomId: newRoomId(), ownerFp: await ownerFingerprint(person.pk) });
  expect(await calls.proveSeat(other)).toBeNull();
  mutate((s) => (s.channels = [{ label: "kiwi", pk: seat.pk, sk: seat.sk, code }]));
  expect(await calls.proveSeat(code)).toBeNull();
});
