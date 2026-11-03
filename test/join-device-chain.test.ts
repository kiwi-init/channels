import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { certUntil, claimDevice, nextLink, readDeviceList, rootLink, type DeviceLink, type DeviceLinkBody } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { JOIN_BOX_MAX } from "@kiwi/core/membership.ts";
import { claimComputer } from "@kiwi/core/person.ts";
import { startRelay } from "../src/relay/bun.ts";
import { pairComputer, setupChannel, type OwnerSetup, type PairedComputer } from "./owner.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-join-device-chain-"));
let server: ReturnType<typeof startRelay>;
let s: OwnerSetup;
let computer: PairedComputer;
let links: DeviceLink[];

async function grow(from: DeviceLink[], signer: Identity, body: DeviceLinkBody): Promise<DeviceLink[]> {
  const read = await readDeviceList(from);
  if (!read.ok) throw new Error(read.why);
  return [...from, await nextLink(read.list, signer, body, Date.now())];
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  s = await setupChannel(server.url.origin);
  const desk = await withExchangeKey(await generateIdentity("desk"));
  computer = await pairComputer(s.person, "box");
  const until = certUntil(Date.now());
  links = [await rootLink(s.person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  links = await grow(links, desk, { op: "add", device: computer.machine.pk, dxpk: computer.machine.xpk!, label: "box", os: "darwin", as: "computer", approve: false, until });
  for (let i = 0; i < 10; i++) {
    const phone = await withExchangeKey(await generateIdentity(`phone-${i}`));
    links = await grow(links, desk, { op: "add", device: phone.pk, dxpk: phone.xpk!, label: `iPhone ${i}`, os: "iOS", as: "phone", approve: false, until });
    links = await grow(links, desk, { op: "revoke", device: phone.pk });
  }
});

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("a join request carries its computer's whole device list", () => {
  test("an agent on a computer whose person churned through devices still asks to join, and its own computer lets it in", async () => {
    const agent = await generateIdentity("nova");
    const claims = {
      computer: await claimComputer(computer.machine, computer.cert, s.roomId, agent.pk),
      device: await claimDevice(computer.machine, links, s.roomId, agent.pk),
    };
    expect(JSON.stringify(claims).length).toBeGreaterThan(4096 * 2);
    const { requestId, computer: delegate } = await Channel.requestJoin(s.relay, s.code, agent, { name: "nova" }, claims);
    expect(delegate).toBe(computer.machine.pk);
    await s.ownerCh.autoApprove(s.person.pk);
    await Channel.joinStatus(s.relay, s.code, agent, requestId);
    const asked = (await s.ownerCh.requests({ person: s.person.pk })).find((r) => r.id === requestId);
    expect(asked?.computer?.own).toBe(true);
    expect((await s.ownerCh.autoApprove(s.person.pk)).map((m) => m.pk)).toContain(agent.pk);
    expect((await Channel.joinStatus(s.relay, s.code, agent, requestId)).status).toBe("approved");
  });

  test("a request sealed past the cap is still refused", async () => {
    const agent = await generateIdentity("huge");
    const asked = Channel.requestJoin(s.relay, s.code, agent, { name: "huge" }, { pin: "x".repeat(JOIN_BOX_MAX) });
    expect(asked).rejects.toThrow("request too large");
  });
});
