import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { certUntil, claimDevice, nextLink, readDeviceList, rootLink, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { rootOf, type Seat } from "@kiwi/core/room-rules.ts";
import { fold, placeKey, rosterOf } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { joinPerson, setupChannel, type OwnerSetup } from "./owner.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-dm-devices-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const device = async (name: string) => withExchangeKey(await generateIdentity(name));

async function joinPhone(person: Identity, name: string): Promise<{ id: Identity; ch: Channel }> {
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

describe("a DM is between two people, whichever of their devices they write from (T966)", () => {
  test("tia's desktop and phone write into one conversation with the owner, and so does the owner's reply", async () => {
    const tiaPerson = await generateIdentity("tia-person");
    const tia = await joinPerson(s, "tia", tiaPerson);
    const phone = await joinPhone(tiaPerson, "tia");
    expect(phone.id.name).toBe("tia-2");

    const fromDesk = await tia.ch.send("from my desk", { to: [s.owner.name], dm: true });
    const fromPhone = await phone.ch.send("from my phone", { to: [s.owner.name], dm: true });
    const toPhone = await s.ownerCh.send("got both", { to: ["tia-2"], dm: true });
    const state = fold((await s.ownerCh.history(0)).messages, rosterOf(await s.ownerCh.members()));
    const keys = [fromDesk, fromPhone, toPhone].map((seq) => placeKey(state.placeOf.get(seq)!));
    expect(keys).toEqual([`dm:${[s.owner.name, "tia"].sort().join("~")}`, `dm:${[s.owner.name, "tia"].sort().join("~")}`, `dm:${[s.owner.name, "tia"].sort().join("~")}`]);
  });

  test("a DM to your own other device isn't a DM", async () => {
    const tiaPerson = await generateIdentity("ana-person");
    const ana = await joinPerson(s, "ana", tiaPerson);
    await joinPhone(tiaPerson, "ana");
    const self = await ana.ch.send("note to my phone", { to: ["ana-2"], dm: true });
    const state = fold((await s.ownerCh.history(0)).messages, rosterOf(await s.ownerCh.members()));
    expect(state.placeOf.get(self)?.kind).toBe("main");
  });
});

describe("whose seat is whose comes from the signed person key, never a matching handle (T966)", () => {
  const seat = (name: string, more: Partial<Seat> = {}): [string, Seat] => [name, { name, pk: `pk-${name}`, kind: "human", active: true, ...more }];

  test("a device seat belongs to the seat its record names only when both carry the same person key", () => {
    const members = new Map([
      seat("jow", { owner: true }),
      seat("jow-2", { sponsor: { user: "p-jow", handle: "jow" } }),
      seat("tia", { sponsor: { user: "p-tia", handle: "tia" } }),
      seat("tia-2", { sponsor: { user: "p-tia", handle: "tia" } }),
    ]);
    expect(["jow", "jow-2", "tia", "tia-2"].map((n) => rootOf(n, members))).toEqual(["jow", "jow", "tia", "tia"]);
  });

  test("someone whose handle collides with tia's name stays themselves, and an agent never folds into its person", () => {
    const members = new Map([
      seat("tia", { sponsor: { user: "p-tia", handle: "tia" } }),
      seat("eve", { sponsor: { user: "p-eve", handle: "tia" } }),
      seat("ana", { kind: "agent", sponsor: { user: "p-tia", handle: "tia" } }),
    ]);
    expect(["eve", "ana"].map((n) => rootOf(n, members))).toEqual(["eve", "ana"]);
  });
});
