import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { newRoomId } from "@kiwi/core/crypto.ts";
import { certUntil, claimDevice, nextLink, readDeviceList, rootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { fold, rosterOf } from "@kiwi/core/state.ts";
import { runAgent } from "../src/agent.ts";
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

describe("what you've read follows you across your devices (T976)", () => {
  let self: string;

  test("reading on the desktop marks the phone read too, and marks never go backwards", async () => {
    expect(await desk.ch.syncMarks({ main: 10, "task:3": 4 })).toEqual({ main: 10, "task:3": 4 });
    self = [...(await state(desk.ch)).rooms.values()].find((r) => r.self)!.id;
    await phone.ch.history(0);
    expect(await phone.ch.syncMarks({}, { write: false })).toEqual({ main: 10, "task:3": 4 });
    expect(await phone.ch.syncMarks({ main: 8, "dm:bo~tia": 6 })).toEqual({ main: 10, "task:3": 4, "dm:bo~tia": 6 });
    expect(await desk.ch.syncMarks({ main: 12 }, { write: false })).toEqual({ main: 12, "task:3": 4, "dm:bo~tia": 6 });
  });

  test("the log only gains the person's own room: syncing many times adds nothing", async () => {
    const before = await logSize();
    for (let i = 13; i < 20; i++) await desk.ch.syncMarks({ main: i });
    expect(await logSize()).toBe(before);
  });

  test("a new session that starts from a snapshot finds the person's own room instead of making another (T1299)", async () => {
    expect(await runAgent(s.ownerCh.fx.snapshotIfDue(1))).toBeGreaterThan(0);
    const fresh = new Channel(desk.ch.access, s.relay, desk.id);
    expect((await fresh.snapshot())?.rooms.some((r) => r.id === self)).toBe(true);
    const before = await logSize();
    expect(await fresh.syncMarks({ main: 19 })).toMatchObject({ main: 19, "task:3": 4 });
    expect(await logSize()).toBe(before);
  });

  test("someone else keeps marks of their own, and the person's own room carries no messages", async () => {
    expect(await bo.ch.syncMarks({ main: 3 })).toEqual({ main: 3 });
    expect(await desk.ch.syncMarks({}, { write: false })).toMatchObject({ main: 19 });
    expect(await bo.ch.syncMarks({}, { write: false })).toEqual({ main: 3 });
    const outside = await state(bo.ch);
    expect(outside.rooms.get(self)?.members?.map((m) => m.name)).not.toContain("bo");
    const letter = await desk.ch.send("a message in my own room", { room: self });
    expect((await state(phone.ch)).rejected.get(letter)).toBe("a person's own room carries no messages");
  });

  test("a 'person's own room' that lists someone else is refused", async () => {
    const members = [desk.id, bo.id].map((w) => ({ name: w.name, pk: w.pk }));
    const seq = await desk.ch.send("keeps their own notes", { kind: "event", ev: { op: "room.create", id: newRoomId(), name: "", members, self: true } });
    expect((await state(bo.ch)).rejected.get(seq)).toBe("a person's own room holds only that person's devices");
  });

  test("removing the phone keeps the marks on the desktop", async () => {
    await s.ownerCh.remove(phone.id.pk);
    await desk.ch.history(0);
    expect(await desk.ch.syncMarks({}, { write: false })).toMatchObject({ main: 19, "task:3": 4, "dm:bo~tia": 6 });
  });
});
