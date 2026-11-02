import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { certUntil, claimDevice, nextLink, readDeviceList, rootLink, type DeviceLink, type DeviceLinkBody, type DeviceList } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { fold, rosterOf, type ChannelState } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinAgent, joinPerson, pairComputer, setupChannel, type OwnerSetup, type PairedComputer } from "./owner.ts";

setDefaultTimeout(120_000);

const REFUSED = "only the owner, the key itself, or the person it belongs to says a key is gone";

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-own-devices-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
type Seat = { id: Identity; ch: Channel };
let person: Identity;
let desk: Identity;
let phoneKey: Identity;
let tabletKey: Identity;
let computer: PairedComputer;
let links: DeviceLink[];
let tia: Seat;
let phone: Seat;
let tablet: Seat;
let bot: Seat;
let maya: Seat;

async function grow(from: DeviceLink[], signer: Identity, body: DeviceLinkBody): Promise<DeviceLink[]> {
  const read = await readDeviceList(from);
  if (!read.ok) throw new Error(read.why);
  return [...from, await nextLink(read.list, signer, body, Date.now())];
}

async function listOf(from: DeviceLink[]): Promise<DeviceList> {
  const read = await readDeviceList(from);
  if (!read.ok) throw new Error(read.why);
  return read.list;
}

async function joinDevice(key: Identity, name: string): Promise<Seat> {
  const id = await generateIdentity(name);
  const { requestId } = await Channel.requestJoin(s.relay, s.code, id, { name }, { device: await claimDevice(key, links, s.roomId, id.pk) });
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
  person = await generateIdentity("tia-person");
  desk = await withExchangeKey(await generateIdentity("desk"));
  phoneKey = await withExchangeKey(await generateIdentity("phone"));
  tabletKey = await withExchangeKey(await generateIdentity("tablet"));
  computer = await pairComputer(person);
  const until = certUntil(Date.now());
  links = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  links = await grow(links, desk, { op: "add", device: phoneKey.pk, dxpk: phoneKey.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until });
  links = await grow(links, desk, { op: "add", device: tabletKey.pk, dxpk: tabletKey.xpk!, label: "tablet", os: "iPadOS", as: "phone", approve: false, until });
  links = await grow(links, desk, { op: "add", device: computer.machine.pk, dxpk: computer.machine.xpk!, label: "box", os: "Linux", as: "computer", approve: false, until });
  tia = await joinPerson(s, "tia", person);
  phone = await joinDevice(phoneKey, "tia");
  tablet = await joinDevice(tabletKey, "tia");
  bot = await joinAgent(s, "tia-bot", computer);
  maya = await joinPerson(s, "maya", await generateIdentity("maya-person"));
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function log(): Promise<Message[]> {
  return (await s.ownerCh.history(0)).messages;
}

async function judged(): Promise<ChannelState> {
  return fold(await log(), rosterOf(await s.ownerCh.members()), Date.now());
}

const removes = (by: Seat, target: Seat): Promise<number> => by.ch.send("removed", { kind: "event", ev: { op: "member.gone", member: target.id.name, pk: target.id.pk } });
const relayHas = async (who: Seat): Promise<boolean> => !!(await s.ownerCh.members()).find((m) => m.pk === who.id.pk)?.active;

describe("a person cuts their own old devices from a channel without waiting for the owner (T1408)", () => {
  test("the phone and tablet seats are the same person as the desktop seat", async () => {
    const members = await s.ownerCh.members();
    const sponsorOf = (who: Seat) => members.find((m) => m.pk === who.id.pk)?.sponsor?.user;
    expect([phone, tablet].map(sponsorOf)).toEqual([person.pk, person.pk]);
    expect(sponsorOf(tia)).toBe(person.pk);
  });

  test("another person, and an agent of the same person, can't cut a person's device; nobody but the owner cuts the owner", async () => {
    const owner = { id: s.owner, ch: s.ownerCh };
    const tries = [await removes(maya, phone), await removes(bot, phone), await removes(tia, owner), await removes(tia, maya)];
    const state = await judged();
    for (const seq of tries) expect(state.rejected.get(seq)).toBe(REFUSED);
    for (const who of [phone, owner, maya]) expect(state.gone.has(who.id.pk)).toBe(false);
  });

  test("the desktop cuts the phone: every fold drops it at once, and the owner's app finishes it at the relay", async () => {
    const before = (await s.ownerCh.info()).epoch;
    const seq = await removes(tia, phone);
    const state = await judged();
    expect(state.rejected.get(seq)).toBeUndefined();
    expect(state.gone.get(phone.id.pk)).toBe(seq);
    expect(state.members.get(phone.id.name)?.active).toBe(false);
    expect(state.members.get("tia")?.active).toBe(true);
    expect(await s.ownerCh.reconcilePosting(state, await s.ownerCh.members())).toEqual([phone.id.pk]);
    expect(await relayHas(phone)).toBe(false);
    expect((await s.ownerCh.info()).epoch).toBeGreaterThan(before);
  });

  test("goneDevices logs the cut for every seat and agent on a device the person's own list revoked, and nothing for anyone else", async () => {
    links = await grow(links, desk, { op: "revoke", device: tabletKey.pk });
    links = await grow(links, desk, { op: "revoke", device: computer.machine.pk });
    const list = await listOf(links);
    expect(list.revoked).toEqual(expect.arrayContaining([tabletKey.pk, computer.machine.pk]));
    expect((await maya.ch.goneDevices(list)).map((m) => m.name)).toEqual([]);
    expect((await s.ownerCh.goneDevices(list)).map((m) => m.name)).toEqual([]);
    const cut = await tia.ch.goneDevices(list);
    expect(cut.map((m) => m.pk).sort()).toEqual([tablet.id.pk, bot.id.pk].sort());
    const state = await judged();
    for (const who of [tablet, bot]) {
      expect(state.gone.has(who.id.pk)).toBe(true);
      expect(state.members.get(who.id.name)?.active).toBe(false);
    }
    expect(state.members.get("tia")?.active).toBe(true);
    expect([...state.rejected.values()].filter((why) => why === REFUSED)).toHaveLength(4);
    const said = (await log()).flatMap((m) => (m.ev?.op === "member.gone" && m.from === "tia" && m.ev.why ? [[m.ev.member, m.ev.why]] : []));
    expect(said).toEqual(
      expect.arrayContaining([
        [tablet.id.name, 'their phone "tablet" was forgotten from their devices'],
        ["tia-bot", `tia-bot's computer "test-computer" was forgotten from @tia's devices`],
      ]),
    );
    await s.ownerCh.reconcilePosting(state, await s.ownerCh.members());
    for (const who of [tablet, bot]) expect(await relayHas(who)).toBe(false);
  });
});
