import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { certUntil, nextLink, readDeviceList, rootLink, type DeviceLink, type DeviceLinkBody } from "@kiwi/core/devices.ts";
import { accountScope } from "@kiwi/core/enroll.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { makeAsk, readAnswer } from "@kiwi/core/machine-ask.ts";
import { newSecret, openMailbox } from "@kiwi/core/mailbox.ts";
import { certifyMachine } from "@kiwi/core/person.ts";
import { startMachineInbox } from "../src/daemon/inbox.ts";
import { loadPairedMachine, type PairedMachine } from "../src/daemon/pair.ts";
import { remoteRunner } from "../src/daemon/remote.ts";
import { newMachine, saveMachine, takeDeviceList } from "../src/machine.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";

setDefaultTimeout(60_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-kp1-computer-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

const user = { id: "dev_kp1owner", token: "dev:kp1owner" };
let server: ReturnType<typeof startRelay>;
let relay: string;
let person: Identity;
let desk: Identity;
let phone: Identity;
let machine: Identity;
let links: DeviceLink[];
let inbox: { stop(): void; close(): void };

const key = async (name: string) => withExchangeKey(await generateIdentity(name));

async function grow(from: DeviceLink[], signer: Identity, body: DeviceLinkBody): Promise<DeviceLink[]> {
  const read = await readDeviceList(from);
  if (!read.ok) throw new Error(read.why);
  return [...from, await nextLink(read.list, signer, body)];
}

const computer = (m: Identity): DeviceLinkBody => ({ op: "add", device: m.pk, dxpk: m.xpk!, label: "old box", os: "Linux", as: "computer", approve: false, until: certUntil(Date.now()) });

async function publish(next: DeviceLink[]): Promise<number> {
  const text = JSON.stringify({ links: next });
  const auth = await signRequest(desk, accountScope(user.id), "PUT", "/v1/account", text);
  return (await fetch(`${relay}/v1/account`, { method: "PUT", headers: { "x-human-token": user.token, authorization: `Bearer ${auth}`, "content-type": "application/json" }, body: text })).status;
}

async function post(as: Identity, box: string): Promise<number> {
  const path = `/v1/machine/${machine.pk}/inbox`;
  const body = JSON.stringify({ box });
  const token = await signRequest(as, `machine:${machine.pk}`, "POST", path, body);
  return (await fetch(relay + path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body })).status;
}

async function online(): Promise<boolean> {
  const path = `/v1/machine/${machine.pk}`;
  const token = await signRequest(person, `machine:${machine.pk}`, "GET", path);
  const res = await fetch(relay + path, { headers: { authorization: `Bearer ${token}` } });
  return res.ok && ((await res.json()) as { online?: boolean }).online === true;
}

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(home, "relay"), human: devHumanAuth() });
  relay = server.url.origin;
  person = await key("person");
  desk = await key("desk");
  phone = await key("phone");
  const made = await newMachine(relay);
  machine = made.identity;
  links = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  links = await grow(links, desk, { op: "add", device: phone.pk, dxpk: phone.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) });
  expect(await publish(links)).toBe(204);
  const cert = await certifyMachine(person, { pk: machine.pk, xpk: machine.xpk!, label: "old box" });
  const paired: PairedMachine = { ...made, cert, person: { pk: person.pk, xpk: person.xpk!, name: "person" } };
  saveMachine(paired);
  inbox = startMachineInbox({
    dir: home,
    machine: loadPairedMachine,
    checkMs: 100,
    unpaired: async () => {},
    listed: async (l) => (await takeDeviceList(l)) === "longer",
    run: remoteRunner({ inventory: async () => [], folders: () => ["/work"], launch: async () => ({ ok: false, why: "failed", detail: "unused" }) }),
  });
  await until("the cert-paired inbox online", online);
});

afterAll(() => {
  inbox.stop();
  server.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

describe("a computer paired by an old person-signed cert (kp1), once the person key is offline", () => {
  test("takes no list that isn't its person's, or that doesn't name it", async () => {
    const stranger = await key("stranger");
    const theirs = await grow([await rootLink(stranger, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })], desk, computer(machine));
    expect(await takeDeviceList(theirs)).toBeNull();
    expect(await takeDeviceList(links)).toBeNull();
    expect(loadPairedMachine()?.device).toBeUndefined();
    const { box } = await makeAsk(desk, { pk: machine.pk, xpk: machine.xpk! }, { verb: "folders", args: {}, reply: newSecret() });
    expect(await post(desk, box)).toBe(403);
  });

  test("named in the account's list, it takes that list from the relay and answers an approving desktop, not a phone", async () => {
    const named = await grow(links, desk, computer(machine));
    expect(await publish(named)).toBe(204);
    await until("the computer to keep the list", () => loadPairedMachine()?.device?.links.length === named.length);
    expect(loadPairedMachine()?.cert?.pk).toBe(person.pk);
    await until("the inbox back online", online);
    const reply = newSecret();
    const { box, id } = await makeAsk(desk, { pk: machine.pk, xpk: machine.xpk! }, { verb: "folders", args: {}, reply });
    expect(await post(desk, box)).toBe(202);
    const got = await (await openMailbox(relay, reply)).wait("b", { timeoutMs: 6_000, everyMs: 100 });
    expect((await readAnswer(got, { machine: machine.pk, id }))?.result).toEqual({ ok: true, folders: ["/work"] });
    const fromPhone = await makeAsk(phone, { pk: machine.pk, xpk: machine.xpk! }, { verb: "folders", args: {}, reply: newSecret() });
    expect(await post(phone, fromPhone.box)).toBe(403);
  });
});
