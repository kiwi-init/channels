import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { newRoomId } from "@kiwi/core/crypto.ts";
import { certUntil, claimDevice, nextLink, readDeviceList, rootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { newRoomKey, sealRoom, type RoomMeta } from "@kiwi/core/private-room.ts";
import { fold, rosterOf } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { runAgent } from "../src/agent.ts";
import { joinAgent, joinPerson, pairComputer, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-private-dms-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
type Seat = { id: Identity; ch: Channel };
let tia: Seat;
let tiaPhone: Seat;
let bo: Seat;
let cy: Seat;
let ana: Seat;

const device = async (name: string) => withExchangeKey(await generateIdentity(name));

async function joinPhone(person: Identity, name: string): Promise<Seat> {
  const desk = await device("desk");
  const phone = await device("phone");
  const root = await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" });
  const read = await readDeviceList([root]);
  if (!read.ok) throw new Error(read.why);
  const links: DeviceLink[] = [
    root,
    await nextLink(read.list, desk, { op: "add", device: phone.pk, dxpk: phone.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) }),
  ];
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

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  const tiaPerson = await generateIdentity("tia-person");
  tia = await joinPerson(s, "tia", tiaPerson);
  tiaPhone = await joinPhone(tiaPerson, "tia");
  bo = await joinPerson(s, "bo", await generateIdentity("bo-person"));
  cy = await joinPerson(s, "cy", await generateIdentity("cy-person"));
  ana = await joinAgent(s, "ana", await pairComputer(s.person));
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const state = async (ch: Channel) => fold((await ch.history(0)).messages, rosterOf(await s.ownerCh.members()));
const pick = (x: Seat) => ({ name: x.id.name, pk: x.id.pk, xpk: x.id.xpk! });

async function forge(from: Seat, who: Seat[], meta: Partial<RoomMeta> = {}): Promise<number> {
  const id = newRoomId();
  const sealed = await sealRoom(
    s.roomId,
    id,
    1,
    newRoomKey(),
    { name: "", members: who.map((w) => ({ name: w.id.name, pk: w.id.pk })), dm: true, ...meta },
    who.map((w) => w.id.xpk!),
  );
  return from.ch.send("started a private conversation", { kind: "event", ev: { op: "room.seal", ...sealed } });
}

describe("a DM between two people has its own key (T1149)", () => {
  let id: string;
  let earlier: number;

  test("two people who aren't trusted start one: it reaches every device of both, and only them", async () => {
    id = await tia.ch.makeDm(pick(bo));
    const seen = await state(bo.ch);
    expect(
      seen.rooms
        .get(id)
        ?.members?.map((m) => m.name)
        .sort(),
    ).toEqual(["bo", "tia", "tia-2"]);
    expect(seen.rooms.get(id)?.dm).toBe(true);
    await tiaPhone.ch.history(0);
    earlier = await tiaPhone.ch.send("only bo reads this", { room: id });
    expect((await state(tiaPhone.ch)).rejected.get(earlier)).toBeUndefined();
    expect((await bo.ch.history(0)).messages.find((m) => m.seq === earlier)?.body).toBe("only bo reads this");
  });

  test("everyone else sees no room, no refusal and no text, and keeps the sealed key history for snapshots", async () => {
    for (const outsider of [s.ownerCh, cy.ch]) {
      const seen = await state(outsider);
      expect(seen.rooms.has(id)).toBe(false);
      expect([...seen.rejected.values()].filter((why) => /private|direct message/.test(why))).toEqual([]);
      expect(seen.secret.get(id)?.seals.length).toBe(1);
      expect((await outsider.history(0)).messages.some((m) => m.body === "only bo reads this")).toBe(false);
    }
  });

  test("a fresh app of bo's, starting from a snapshot an outsider wrote, still reads the earlier letters", async () => {
    expect(await runAgent(s.ownerCh.fx.snapshotIfDue(1))).toBeGreaterThan(0);
    const fresh = new Channel(bo.ch.access, s.relay, bo.id);
    const base = (await fresh.snapshot())!;
    const opened = await fresh.openRooms(base);
    expect(opened.rooms.find((r) => r.id === id)?.dm).toBe(true);
    expect((await fresh.history(0)).messages.find((m) => m.seq === earlier)?.body).toBe("only bo reads this");
  });

  test("its members refuse a 'DM' that lists a third person or an agent, or that grows into a group", async () => {
    const third = await forge(tia, [tia, bo, cy]);
    const agent = await forge(tia, [tia, ana]);
    const grow = await tia.ch.send("changed a private room", {
      kind: "event",
      ev: {
        op: "room.seal",
        ...(await sealRoom(
          s.roomId,
          id,
          1,
          (await state(tia.ch)).secret.get(id) ? newRoomKey() : newRoomKey(),
          { name: "", members: [pick(tia), pick(bo), pick(cy)].map(({ name, pk }) => ({ name, pk })), dm: true },
          [pick(tia), pick(bo), pick(cy)].map((p) => p.xpk),
        )),
      },
    });
    expect((await state(bo.ch)).rejected.get(third)).toBe("a direct message's room is between exactly two people");
    expect((await state(cy.ch)).rejected.get(third)).toBe("a direct message's room is between exactly two people");
    expect((await state(tia.ch)).rejected.get(agent)).toBe("a direct message's room is between exactly two people");
    expect((await state(bo.ch)).rejected.get(grow)).toBeDefined();
    expect(
      (await state(bo.ch)).rooms
        .get(id)
        ?.members?.map((m) => m.name)
        .sort(),
    ).toEqual(["bo", "tia", "tia-2"]);
  });

  test("a private room can't be turned into a DM", async () => {
    const room = await s.ownerCh.makeRoom("pair", [pick(bo)]);
    const now = (await state(s.ownerCh)).secret.get(room)!;
    const last = now.seals.at(-1)!;
    const { renameRoom } = await import("@kiwi/core/private-room.ts");
    const key = (await import("@kiwi/core/private-room.ts")).openRoomKey;
    const k = await key(s.roomId, last, s.owner.xsk!);
    const sealed = await renameRoom(s.roomId, last, k!, { name: "", members: now.meta!.members, dm: true });
    const seq = await s.ownerCh.send("changed a private room", { kind: "event", ev: { op: "room.seal", ...sealed } });
    expect((await state(bo.ch)).rejected.get(seq)).toBe("a room can't become a direct message");
  });

  test("when a device of theirs is removed, either of the two moves the DM to a new key", async () => {
    await s.ownerCh.remove(tiaPhone.id.pk);
    await bo.ch.history(0);
    expect(await bo.ch.pruneRooms([id])).toEqual([id]);
    const seen = await state(bo.ch);
    expect(
      seen.rooms
        .get(id)
        ?.members?.map((m) => m.name)
        .sort(),
    ).toEqual(["bo", "tia"]);
    expect(seen.secret.get(id)?.n).toBe(2);
    await tia.ch.history(0);
    const after = await tia.ch.send("still just us", { room: id });
    expect((await state(tia.ch)).rejected.get(after)).toBeUndefined();
  });
});
