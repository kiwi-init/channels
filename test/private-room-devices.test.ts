import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { certUntil, claimDevice, nextLink, readDeviceList, rootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { fold, rosterOf } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinPerson, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-room-devices-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
type Seat = { id: Identity; ch: Channel };
const ALL = { addsAgents: true, answersDecisions: true, managesAgents: true };

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const device = async (name: string) => withExchangeKey(await generateIdentity(name));

async function phoneOf(person: Identity): Promise<{ links: DeviceLink[]; phone: Identity }> {
  const desk = await device("desk");
  const phone = await device("phone");
  const root = await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" });
  const read = await readDeviceList([root]);
  if (!read.ok) throw new Error(read.why);
  const links = [root, await nextLink(read.list, desk, { op: "add", device: phone.pk, dxpk: phone.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) })];
  return { links, phone };
}

async function joinPhone(person: Identity, name: string): Promise<Seat> {
  const { links, phone } = await phoneOf(person);
  const id = await generateIdentity(name);
  const { requestId } = await Channel.requestJoin(s.relay, s.code, id, { name }, { device: await claimDevice(phone, links, s.roomId, id.pk) });
  await s.ownerCh.autoApprove(s.person.pk);
  await Channel.joinStatus(s.relay, s.code, id, requestId);
  await s.ownerCh.autoApprove(s.person.pk);
  const st = await Channel.joinStatus(s.relay, s.code, id, requestId);
  if (st.status !== "approved") throw new Error(`not approved: ${st.status}`);
  const seat = { ...id, name: (await s.ownerCh.members()).find((m) => m.pk === id.pk)!.name };
  return { id: seat, ch: new Channel(st.access, s.relay, seat) };
}

const state = async (ch: Channel) => fold((await ch.history(0)).messages, rosterOf(await s.ownerCh.members()));
const pick = (x: Seat, name: string) => ({ name, pk: x.id.pk, xpk: x.id.xpk! });
const names = async (ch: Channel, id: string) =>
  (await state(ch)).rooms
    .get(id)
    ?.members?.map((m) => m.name)
    .sort();

describe("a private room opens on every device of a person in it (T1046)", () => {
  let tia: Seat;
  let tiaPhone: Seat;
  let tiaPerson: Identity;

  test("a room picked for a person seals to their phone too, and the phone reads and writes in it", async () => {
    tiaPerson = await generateIdentity("tia-person");
    tia = await joinPerson(s, "tia", tiaPerson, ALL);
    tiaPhone = await joinPhone(tiaPerson, "tia");
    expect((await s.ownerCh.members()).find((m) => m.pk === tiaPhone.id.pk)?.name).toBe("tia-2");

    const id = await s.ownerCh.makeRoom("plans", [pick(tia, "tia")]);
    expect(await names(s.ownerCh, id)).toEqual([s.owner.name, "tia", "tia-2"].sort());
    const said = await tiaPhone.ch.send("from the phone", { room: id });
    expect((await state(tiaPhone.ch)).rejected.get(said)).toBeUndefined();
    const read = (await tia.ch.history(0)).messages.find((m) => m.seq === said);
    expect(read?.body).toBe("from the phone");
  });

  test("whoever makes a room brings all of their own devices into it", async () => {
    const id = await tia.ch.makeRoom("tia's", []);
    expect(await names(tia.ch, id)).toEqual(["tia", "tia-2"]);
  });

  test("a device that joins later is sealed in on the same key; a device that's removed moves the room to a new key", async () => {
    const boPerson = await generateIdentity("bo-person");
    const bo = await joinPerson(s, "bo", boPerson, ALL);
    const id = await s.ownerCh.makeRoom("with-bo", [pick(bo, "bo")]);
    expect(await names(s.ownerCh, id)).toEqual([s.owner.name, "bo"].sort());

    const boPhone = await joinPhone(boPerson, "bo");
    await s.ownerCh.history(0);
    expect(await s.ownerCh.pruneRooms([id])).toEqual([id]);
    const grown = await state(s.ownerCh);
    expect(
      grown.rooms
        .get(id)
        ?.members?.map((m) => m.name)
        .sort(),
    ).toEqual([s.owner.name, "bo", "bo-2"].sort());
    expect(grown.secret.get(id)?.n).toBe(1);
    await boPhone.ch.history(0);
    const said = await boPhone.ch.send("bo's phone is in", { room: id });
    expect((await state(boPhone.ch)).rejected.get(said)).toBeUndefined();
    expect(await s.ownerCh.pruneRooms([id])).toEqual([]);

    await s.ownerCh.remove(boPhone.id.pk);
    await s.ownerCh.history(0);
    expect(await s.ownerCh.pruneRooms([id])).toEqual([id]);
    const cut = await state(s.ownerCh);
    expect(
      cut.rooms
        .get(id)
        ?.members?.map((m) => m.name)
        .sort(),
    ).toEqual([s.owner.name, "bo"].sort());
    expect(cut.secret.get(id)?.n).toBe(2);
  });

  test("taking a person out of a room takes all of their devices out", async () => {
    const id = await s.ownerCh.makeRoom("then-not", [pick(tia, "tia")]);
    expect(await names(s.ownerCh, id)).toEqual([s.owner.name, "tia", "tia-2"].sort());
    await s.ownerCh.changeRoom(id, { members: [] });
    expect(await names(s.ownerCh, id)).toEqual([s.owner.name]);
  });
});
