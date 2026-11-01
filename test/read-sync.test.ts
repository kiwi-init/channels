import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { newRoomId } from "@kiwi/core/crypto.ts";
import { certUntil, claimDevice, nextLink, readDeviceList, rootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { newRoomKey, sealRoom } from "@kiwi/core/private-room.ts";
import { fold, rosterOf } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinPerson, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-read-sync-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
type Seat = { id: Identity; ch: Channel };
let desk: Seat;
let phone: Seat;
let bo: Seat;

async function joinPhone(person: Identity, name: string): Promise<Seat> {
  const d = await withExchangeKey(await generateIdentity("desk"));
  const p = await withExchangeKey(await generateIdentity("phone"));
  const root = await rootLink(person, { pk: d.pk, xpk: d.xpk!, label: "desk", os: "macOS", as: "desktop" });
  const read = await readDeviceList([root]);
  if (!read.ok) throw new Error(read.why);
  const links: DeviceLink[] = [root, await nextLink(read.list, d, { op: "add", device: p.pk, dxpk: p.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) })];
  const id = await generateIdentity(name);
  const { requestId } = await Channel.requestJoin(s.relay, s.code, id, { name }, { device: await claimDevice(p, links, s.roomId, id.pk) });
  await s.ownerCh.autoApprove(s.person.pk);
  await Channel.joinStatus(s.relay, s.code, id, requestId);
  await s.ownerCh.autoApprove(s.person.pk);
  const st = await Channel.joinStatus(s.relay, s.code, id, requestId);
  if (st.status !== "approved") throw new Error(`not approved: ${st.status}`);
  const seat = { ...id, name: (await s.ownerCh.members()).find((m) => m.pk === id.pk)!.name };
  return { id: seat, ch: new Channel(st.access, s.relay, seat) };
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  const person = await generateIdentity("tia-person");
  desk = await joinPerson(s, "tia", person);
  phone = await joinPhone(person, "tia");
  bo = await joinPerson(s, "bo", await generateIdentity("bo-person"));
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const state = async (ch: Channel) => fold((await ch.history(0)).messages, rosterOf(await s.ownerCh.members()));
const logSize = async () => (await s.ownerCh.history(0)).messages.length;

describe("what you've read follows you across your devices, and nobody else learns it (T976)", () => {
  let self: string;

  test("reading on the desktop marks the phone read too, and marks never go backwards", async () => {
    expect(await desk.ch.syncMarks({ main: 10, "task:3": 4 })).toEqual({ main: 10, "task:3": 4 });
    self = [...(await state(desk.ch)).rooms.values()].find((r) => r.self)!.id;
    await phone.ch.history(0);
    expect(await phone.ch.syncMarks({}, { write: false })).toEqual({ main: 10, "task:3": 4 });
    expect(await phone.ch.syncMarks({ main: 8, "dm:bo~tia": 6 })).toEqual({ main: 10, "task:3": 4, "dm:bo~tia": 6 });
    expect(await desk.ch.syncMarks({ main: 12 }, { write: false })).toEqual({ main: 12, "task:3": 4, "dm:bo~tia": 6 });
  });

  test("the log only gains the room's seal: syncing many times adds nothing", async () => {
    const before = await logSize();
    for (let i = 13; i < 20; i++) await desk.ch.syncMarks({ main: i });
    expect(await logSize()).toBe(before);
  });

  test("everyone else sees no room and no marks, and the person's own room carries no messages", async () => {
    const outside = await state(bo.ch);
    expect(outside.rooms.has(self)).toBe(false);
    expect(outside.secret.get(self)?.seals.length).toBe(1);
    const letter = await desk.ch.send("a message in my own room", { room: self });
    expect((await state(phone.ch)).rejected.get(letter)).toBe("a person's own room carries no messages");
  });

  test("a 'person's own room' that lists someone else is refused", async () => {
    const id = newRoomId();
    const who = [desk.id, bo.id];
    const sealed = await sealRoom(
      s.roomId,
      id,
      1,
      newRoomKey(),
      { name: "", members: who.map((w) => ({ name: w.name, pk: w.pk })), self: true },
      who.map((w) => w.xpk!),
    );
    const seq = await desk.ch.send("keeps a private note", { kind: "event", ev: { op: "room.seal", ...sealed } });
    expect((await state(bo.ch)).rejected.get(seq)).toBe("a person's own room holds only that person's devices");
  });

  test("removing the phone moves the note to a new key, and the marks come along", async () => {
    await s.ownerCh.remove(phone.id.pk);
    await desk.ch.history(0);
    expect(await desk.ch.pruneRooms([self])).toEqual([self]);
    expect((await state(desk.ch)).secret.get(self)?.n).toBe(2);
    expect(await desk.ch.syncMarks({}, { write: false })).toMatchObject({ main: 19, "task:3": 4, "dm:bo~tia": 6 });
  });
});
