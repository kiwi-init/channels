import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { certUntil, nextLink, readDeviceList, rootLink, type DeviceLink, type DeviceLinkBody } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { makeAsk, readAnswer } from "@kiwi/core/machine-ask.ts";
import { newSecret, openMailbox } from "@kiwi/core/mailbox.ts";
import { sealTo } from "@kiwi/core/crypto.ts";
import { sign } from "@kiwi/core/identity.ts";
import { forgetAtRelay, startMachineInbox } from "../src/daemon/inbox.ts";
import type { PairedMachine } from "../src/daemon/pair.ts";
import { remoteRunner } from "../src/daemon/remote.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const root = mkdtempSync(join(tmpdir(), "kiwi-machine-inbox-devices-"));
let server: ReturnType<typeof startRelay>;
let relay: string;
let person: Identity;
let desk: Identity;
let phone: Identity;
let machine: Identity;
let paired: PairedMachine | null;
let inbox: { stop(): void; close(): void };

const key = async (name: string) => withExchangeKey(await generateIdentity(name));

async function grow(links: DeviceLink[], signer: Identity, body: DeviceLinkBody): Promise<DeviceLink[]> {
  const read = await readDeviceList(links);
  if (!read.ok) throw new Error(read.why);
  return [...links, await nextLink(read.list, signer, body)];
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay") });
  relay = server.url.origin;
  person = await key("person");
  desk = await key("desk");
  phone = await key("phone");
  machine = await key("machine");
  let links = [await rootLink(person, { pk: desk.pk, xpk: desk.xpk!, label: "desk", os: "macOS", as: "desktop" })];
  links = await grow(links, desk, { op: "add", device: phone.pk, dxpk: phone.xpk!, label: "phone", os: "iOS", as: "phone", approve: false, until: certUntil(Date.now()) });
  links = await grow(links, desk, { op: "add", device: machine.pk, dxpk: machine.xpk!, label: "studio", os: "macOS", as: "computer", approve: false, until: certUntil(Date.now()) });
  paired = { identity: machine, label: "studio", relay, device: { person: { pk: person.pk, xpk: person.xpk!, name: "person" }, links } };
  inbox = startMachineInbox({
    dir: root,
    machine: () => paired,
    checkMs: 100,
    listed: async () => false,
    unpaired: async () => {
      if (paired) await forgetAtRelay(paired);
      paired = paired ? { identity: paired.identity, label: paired.label, relay: paired.relay } : null;
      inbox.close();
    },
    run: remoteRunner({ inventory: async () => [], folders: () => ["/work"], launch: async () => ({ ok: false, why: "failed", detail: "unused" }) }),
  });
  await until("the inbox online", async () => ((await status(desk)) as { online?: boolean }).online === true);
});

afterAll(() => {
  inbox.stop();
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

async function status(as: Identity): Promise<unknown> {
  const path = `/v1/machine/${machine.pk}`;
  const token = await signRequest(as, `machine:${machine.pk}`, "GET", path);
  const res = await fetch(relay + path, { headers: { authorization: `Bearer ${token}` } });
  return res.ok ? res.json() : { status: res.status };
}

async function post(as: Identity, box: string): Promise<number> {
  const path = `/v1/machine/${machine.pk}/inbox`;
  const body = JSON.stringify({ box });
  const token = await signRequest(as, `machine:${machine.pk}`, "POST", path, body);
  return (await fetch(relay + path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body })).status;
}

const log = () => readFileSync(join(root, "remote.log"), "utf8");

describe("a computer paired through its person's device list, with no cert", () => {
  test("registers with the list and answers an ask signed by an approving desktop", async () => {
    const reply = newSecret();
    const { box, id } = await makeAsk(desk, { pk: machine.pk, xpk: machine.xpk! }, { verb: "folders", args: {}, reply });
    expect(await post(desk, box)).toBe(202);
    const got = await (await openMailbox(relay, reply)).wait("b", { timeoutMs: 4_000, everyMs: 100 });
    expect((await readAnswer(got, { machine: machine.pk, id }))?.result).toEqual({ ok: true, folders: ["/work"] });
  });

  test("the relay keeps a phone out, and the daemon refuses a phone's ask that reached it anyway", async () => {
    const { box } = await makeAsk(phone, { pk: machine.pk, xpk: machine.xpk! }, { verb: "folders", args: {}, reply: newSecret() });
    expect(await post(phone, box)).toBe(403);
    const signed = await sign(phone, { kind: "kiwi-machine-ask", v: 1, machine: machine.pk, verb: "folders", args: {}, id: "phoneAsk_0001", at: Date.now(), reply: newSecret() });
    const smuggled = await sealTo(machine.xpk!, JSON.stringify(signed), "kiwi-machine-ask");
    expect(await post(desk, smuggled)).toBe(202);
    await until("the phone's ask refused", () => log().includes("\trefused\tnot-yours\t"));
  });
});
