import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { certUntil, nextLink, readDeviceList, rootLink, type DeviceLink, type DeviceLinkBody, type DeviceList } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { claimComputer } from "@kiwi/core/person.ts";
import { startRelay } from "../src/relay/bun.ts";
import { handshake, joinPerson, pairComputer, setupChannel, type OwnerSetup, type PairedComputer } from "./owner.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-revoked-computer-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
let harry: Identity;
let mac: PairedComputer;
let list: DeviceList;
let dudu: { id: Identity; requestId: string };

async function grow(from: DeviceLink[], signer: Identity, body: DeviceLinkBody): Promise<DeviceLink[]> {
  const read = await readDeviceList(from);
  if (!read.ok) throw new Error(read.why);
  return [...from, await nextLink(read.list, signer, body, Date.now())];
}

async function agentAsks(name: string): Promise<{ id: Identity; requestId: string }> {
  const id = await generateIdentity(name);
  const claim = await claimComputer(mac.machine, mac.cert, s.roomId, id.pk);
  const { requestId } = await Channel.requestJoin(s.relay, s.code, id, { name }, { computer: claim });
  return { id, requestId };
}

async function ownerPass(lists: ReadonlyMap<string, DeviceList>, asked: { id: Identity; requestId: string }): Promise<string[]> {
  await s.ownerCh.autoApprove(s.person.pk, [], null, lists);
  await Channel.joinStatus(s.relay, s.code, asked.id, asked.requestId).catch(() => null);
  return (await s.ownerCh.autoApprove(s.person.pk, [], null, lists)).map((m) => m.name);
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  harry = await generateIdentity("harry-person");
  await joinPerson(s, "harry", harry, { addsAgents: true });
  mac = await pairComputer(harry, "MacBook-Pro-de-Davi");
  const desk = await withExchangeKey(await generateIdentity("desk"));
  let links = [await rootLink(harry, { pk: desk.pk, xpk: desk.xpk!, label: "MacBook-Pro-de-Davi", os: "macOS", as: "desktop" })];
  links = await grow(links, desk, {
    op: "add",
    device: mac.machine.pk,
    dxpk: mac.machine.xpk!,
    label: "MacBook-Pro-de-Davi",
    os: "darwin",
    as: "computer",
    approve: false,
    until: certUntil(Date.now()),
  });
  links = await grow(links, desk, { op: "revoke", device: mac.machine.pk });
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  list = read.list;
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("an agent from a computer its person forgot (#2540, dudu)", () => {
  test("the person's own list revokes the computer, as @harry's #2173 does", () => {
    expect(list.revoked).toEqual([mac.machine.pk]);
    expect(list.devices.map((d) => d.as)).toEqual(["desktop"]);
  });

  test("the owner's app doesn't let it in, so it never has to cut it a moment later", async () => {
    const lists = new Map([[harry.pk, list]]);
    const asked = (dudu = await agentAsks("dudu"));
    expect(await ownerPass(lists, asked)).toEqual([]);
    expect((await s.ownerCh.members()).some((m) => m.active && m.pk === asked.id.pk)).toBe(false);
    const req = (await s.ownerCh.requests({ person: s.person.pk, lists })).find((r) => r.id === asked.requestId);
    expect(req?.computer?.joinsOnItsOwn).toBe(false);
    expect(req?.computer?.revoked).toBe(true);
  });

  test("letting it in by hand is refused too, and says why", async () => {
    const lists = new Map([[harry.pk, list]]);
    await handshake(s, [dudu]);
    const req = (await s.ownerCh.requests({ person: s.person.pk, lists })).find((r) => r.id === dudu.requestId);
    expect(req?.check).toBe("ready");
    expect(req).toBeDefined();
    await expect(s.ownerCh.approve(req!, undefined, { person: s.person.pk })).rejects.toThrow(
      "dudu runs on MacBook-Pro-de-Davi, a computer harry-person forgot from their devices: it can join again once that computer gets a new key (kiwi login on it)",
    );
  });

  test("after kiwi login gives that Mac a new key, the agent comes in on its own and stays", async () => {
    mac = await pairComputer(harry, "MacBook-Pro-de-Davi");
    const desk = list.devices[0]!;
    const deskKey = await withExchangeKey(await generateIdentity("desk-again"));
    expect(desk.device).not.toBe(deskKey.pk);
    const lists = new Map([[harry.pk, list]]);
    const asked = await agentAsks("dudu-2");
    expect(await ownerPass(lists, asked)).toEqual(["dudu-2"]);
    expect(await s.ownerCh.cutDevices(list)).toEqual([]);
    expect((await s.ownerCh.members()).some((m) => m.active && m.pk === asked.id.pk)).toBe(true);
  });
});
