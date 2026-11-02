import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { certUntil, nextLink, readDeviceList, rerootLink, rootLink, type DeviceClaim, type DeviceLink, type DeviceLinkBody } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { recoveryKey, recoveryLink } from "@kiwi/core/recovery.ts";
import { postedProofs } from "../packages/app/src/device-lists.ts";
import { saveConfig, saveIdentity } from "../src/config.ts";
import { listenDaemon, startDaemon, type Daemon } from "../src/daemon.ts";
import { loadMachine, newMachine, saveMachine, type MachineFile } from "../src/machine.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-daemon-devices-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-daemon-devices-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay> | undefined;
let ownerCh: Channel;
let daemon: Daemon | undefined;
let desk: Identity;
let agentPk: string;
let machine: MachineFile;
let links: DeviceLink[];

async function grow(from: DeviceLink[], signer: Identity, body: DeviceLinkBody): Promise<DeviceLink[]> {
  const read = await readDeviceList(from);
  if (!read.ok) throw new Error(read.why);
  return [...from, await nextLink(read.list, signer, body, Date.now())];
}

async function until(check: () => boolean, ms = 15_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await Bun.sleep(50);
  }
  return check();
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const relay = server.url.origin;
  const owner = await generateIdentity("human");
  const agent = await generateIdentity("claude");
  const made = await Channel.create(relay, owner, { name: "human" }, [{ ...agent, info: { name: "claude" } }]);
  ownerCh = new Channel(made.access, relay, owner);
  saveConfig({ channels: { test: { ...(await Channel.resume(relay, made.code, agent)), relay, code: made.code, as: "claude" } } });
  saveIdentity(agent, made.access.roomId);
  const person = await withExchangeKey(await generateIdentity("person"));
  agentPk = agent.pk;
  desk = await withExchangeKey(await generateIdentity("desk"));
  machine = await newMachine(relay);
  const root = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  links = await grow(root, desk, { op: "add", device: machine.identity.pk, dxpk: machine.identity.xpk!, label: "box", os: "Linux", as: "computer", approve: false, until: certUntil(Date.now()) });
  saveMachine({ ...machine, device: { person: { pk: person.pk, name: "human", xpk: person.xpk! }, links } });
  daemon = await startDaemon();
});

afterAll(async () => {
  await daemon?.stop().catch(() => {});
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

test("a seat that reads a newer device list keeps it, and one that revokes this computer drops the device", async () => {
  const sub = await listenDaemon("test", "claude", 0, { noSpawn: true });
  const renewed = await grow(links, desk, { op: "renew", device: machine.identity.pk, until: certUntil(Date.now()) + 1000 });
  await ownerCh.send("updated their list of devices", { kind: "event", ev: { op: "devices", links: renewed } });
  expect(await until(() => loadMachine()?.device?.links.length === renewed.length)).toBe(true);
  const revoked = await grow(renewed, desk, { op: "revoke", device: machine.identity.pk });
  await ownerCh.send("updated their list of devices", { kind: "event", ev: { op: "devices", links: revoked } });
  expect(await until(() => loadMachine()?.device === undefined)).toBe(true);
  expect(loadMachine()?.identity.pk).toBe(machine.identity.pk);
  sub.close();
});

test("after a re-root that keeps this computer, its agent's seat posts the computer's vouch, and the owner links the agent to its person (#1519)", async () => {
  const person = await withExchangeKey(await generateIdentity("person-2"));
  const desk = await withExchangeKey(await generateIdentity("desk-2"));
  const root = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  const links = await grow(root, desk, {
    op: "add",
    device: machine.identity.pk,
    dxpk: machine.identity.xpk!,
    label: "box",
    os: "Linux",
    as: "computer",
    approve: false,
    until: certUntil(Date.now()),
  });
  saveMachine({ ...machine, device: { person: { pk: person.pk, name: "human", xpk: person.xpk! }, links } });
  const sub = await listenDaemon("test", "claude", 0, { noSpawn: true });
  expect((await ownerCh.members()).find((m) => m.pk === agentPk)?.sponsor).toBeUndefined();
  const paper = await recoveryKey(new Uint8Array(32).fill(37));
  const chain = [await recoveryLink(person, person.pk, null, { pk: paper.pk, xpk: paper.xpk! })];
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  const kept = [...links, await rerootLink(read.list, paper, chain, await withExchangeKey(await generateIdentity("next")), [desk.pk, machine.identity.pk])];
  await ownerCh.send("updated their list of devices", { kind: "event", ev: { op: "devices", links: kept } });
  const it = sub[Symbol.asyncIterator]();
  const end = Date.now() + 15_000;
  let vouched = false;
  while (!vouched && Date.now() < end) {
    const next = await Promise.race([it.next(), Bun.sleep(end - Date.now()).then(() => null)]);
    if (!next || next.done) break;
    vouched = next.value.from === "claude" && next.value.ev?.op === "devices" && !!next.value.ev.device;
  }
  expect(vouched).toBe(true);
  const proofs: Record<string, DeviceClaim> = postedProofs((await ownerCh.history(0)).messages);
  expect(proofs[agentPk]).toMatchObject({ links: kept, device: machine.identity.pk });
  const list = await readDeviceList(kept);
  if (!list.ok) throw new Error(list.why);
  expect((await ownerCh.reprove(list.list, proofs)).proved.map((m) => m.name)).toEqual(["claude"]);
  expect((await ownerCh.members()).find((m) => m.pk === agentPk)).toMatchObject({ sponsor: { user: person.pk }, from: { pk: machine.identity.pk, label: "box" } });
  sub.close();
});
