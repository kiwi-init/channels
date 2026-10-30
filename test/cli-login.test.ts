import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { readDeviceList, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { personFingerprint } from "@kiwi/core/fingerprint.ts";
import type { MachineCert } from "@kiwi/core/person.ts";
import type { ComputerView } from "../desktop/src/bridge.ts";
import { createDeviceHost, type DeviceHost } from "../desktop/src/devices.ts";
import { loginComputer } from "../src/login.ts";
import { computerClaimFor, loadMachine, newMachine, saveMachine, type MachineFile } from "../src/machine.ts";
import { loadPairedMachine, PairError, type PairedMachine } from "../src/daemon/pair.ts";
import { startRelay } from "../src/relay/bun.ts";
import { devHumanAuth } from "../src/relay/human.ts";
import { setupChannel } from "./owner.ts";

setDefaultTimeout(30_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-cli-login-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-cli-login-relay-"));
const roomsDir = mkdtempSync(join(tmpdir(), "kiwi-cli-login-rooms-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let accounts: ReturnType<typeof startRelay>;
let rooms: ReturnType<typeof startRelay>;
let relay: string;
let users = 0;

beforeAll(() => {
  accounts = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, human: devHumanAuth() });
  rooms = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: roomsDir });
  relay = accounts.url.origin;
});

afterAll(() => {
  accounts.stop(true);
  rooms.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  for (const d of [home, dataDir, roomsDir]) rmSync(d, { recursive: true, force: true });
});

function freshMachine(): void {
  for (const f of ["machine.json", "machine.json.bak"]) rmSync(join(home, f), { force: true });
}

function desktop(person: Identity, user: string): { host: DeviceHost; held: { device: Identity | null; links: DeviceLink[] }; computers: ComputerView[] } {
  const held: { device: Identity | null; links: DeviceLink[] } = { device: null, links: [] };
  const computers: ComputerView[] = [];
  const host = createDeviceHost({
    relayUrl: () => relay,
    token: async () => `dev:${user}`,
    person: () => person,
    who: () => ({ name: person.name, pk: person.pk, xpk: person.xpk! }),
    device: () => held.device,
    saveDevice: (d) => void (held.device = d),
    links: () => held.links,
    saveLinks: (l) => void (held.links = l),
    channels: () => [],
    computer: (c) => void computers.push(c),
    label: () => "studio",
    os: () => "macOS",
    wipe: () => {},
  });
  return { host, held, computers };
}

async function approveFrom(host: DeviceHost, digits: Promise<string>): Promise<string | null> {
  let ask = await host.poll();
  while (!ask) {
    await Bun.sleep(50);
    ask = await host.poll();
  }
  await host.answer(ask.id);
  const shown = (await host.poll())?.fingerprint ?? null;
  expect(await host.confirm(ask.id, await digits)).toEqual({ ok: true, label: ask.label });
  return shown;
}

function login(user: string, take = true) {
  const lines: string[] = [];
  const asked: { name: string; fingerprint: string }[] = [];
  let shown: (d: string) => void = () => {};
  const digits = new Promise<string>((r) => (shown = r));
  const done = loginComputer({
    relay,
    user,
    everyMs: 50,
    confirm: async (person) => (asked.push(person), take),
    say: (line) => {
      lines.push(line);
      const m = /digits in your app: (\d{3}) (\d{3})/.exec(line);
      if (m) shown(m[1]! + m[2]!);
    },
  });
  return { done, digits, lines, asked };
}

describe("kiwi login keeps a person only once it's checked (#1304)", () => {
  test("the computer asks about the same key the app shows next to the digits", async () => {
    freshMachine();
    const user = `cli${++users}`;
    const person = await withExchangeKey(await generateIdentity("Jow"));
    const app = desktop(person, user);
    await app.host.poll();
    const run = login(user);
    const inApp = await approveFrom(app.host, run.digits);
    await run.done;
    const key = await personFingerprint(person.pk);
    expect(key).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){4}$/);
    expect(inApp).toBe(key);
    expect(run.asked).toEqual([{ name: "Jow", fingerprint: key }]);
  });

  test("a key the person doesn't confirm keeps nothing", async () => {
    freshMachine();
    const user = `cli${++users}`;
    const person = await withExchangeKey(await generateIdentity("Mallory"));
    const app = desktop(person, user);
    await app.host.poll();
    const run = login(user, false);
    void approveFrom(app.host, run.digits);
    await expect(run.done).rejects.toThrow("kept nothing, so kiwi login can ask again with a new key");
    expect(loadMachine()?.device).toBeUndefined();
    expect(loadPairedMachine()?.cert).toBeUndefined();

    const again = login(user);
    await approveFrom(app.host, again.digits);
    expect((await again.done).person.pk).toBe(person.pk);
  });

  test("the person's name shows as plain text, so it can't fake the prompt or hide the key", async () => {
    freshMachine();
    const user = `cli${++users}`;
    const person = await withExchangeKey(await generateIdentity("Jow 1111 2222 3333 4444 5555\n[y/N] \u001b[8m"));
    const app = desktop(person, user);
    await app.host.poll();
    const run = login(user);
    await approveFrom(app.host, run.digits);
    await run.done;
    expect(run.asked).toEqual([{ name: "Jow 1111 2222 3333 4444 5555 [y/N] [8m", fingerprint: await personFingerprint(person.pk) }]);
    expect(run.lines.at(-1)).not.toMatch(/[\u0000-\u001f]/);
  });

  test("a computer that is one person's device asks nothing until kiwi unpair, and logs in again after it with a new key", async () => {
    freshMachine();
    const first = `cli${++users}`;
    const jow = await withExchangeKey(await generateIdentity("Jow"));
    const jowApp = desktop(jow, first);
    await jowApp.host.poll();
    const mine = login(first);
    await approveFrom(jowApp.host, mine.digits);
    await mine.done;
    const enrolled = loadMachine()!;

    const second = `cli${++users}`;
    const other = await withExchangeKey(await generateIdentity("Mallory"));
    const otherApp = desktop(other, second);
    await otherApp.host.poll();
    const refused = login(second);
    await expect(refused.done).rejects.toThrow(`is already one of Jow's devices (key ${await personFingerprint(jow.pk)}): run kiwi unpair first`);
    expect(await otherApp.host.poll()).toBeNull();
    expect(loadMachine()?.device?.person.pk).toBe(jow.pk);

    saveMachine({ identity: enrolled.identity, label: enrolled.label, relay: enrolled.relay });
    const run = login(second);
    await approveFrom(otherApp.host, run.digits);
    expect((await run.done).person.pk).toBe(other.pk);
    expect(loadMachine()).toMatchObject({ label: enrolled.label, relay: enrolled.relay });
    expect(loadMachine()?.identity.pk).not.toBe(enrolled.identity.pk);
  });

  test("a computer adopted while the login waits keeps that adoption (#1304)", async () => {
    freshMachine();
    saveMachine(await newMachine(relay));
    const user = `cli${++users}`;
    const person = await withExchangeKey(await generateIdentity("Jow"));
    const app = desktop(person, user);
    await app.host.poll();
    const lines: string[] = [];
    let shown: (d: string) => void = () => {};
    const digits = new Promise<string>((r) => (shown = r));
    const adopted = { pk: "adopter-key", name: "Ana", xpk: person.xpk! };
    const done = loginComputer({
      relay,
      user,
      everyMs: 50,
      confirm: async () => {
        const m = loadPairedMachine();
        if (!m) throw new Error("no machine");
        const taken: PairedMachine = { ...m, person: adopted };
        saveMachine(taken);
        return true;
      },
      say: (line) => {
        lines.push(line);
        const d = /digits in your app: (\d{3}) (\d{3})/.exec(line);
        if (d) shown(d[1]! + d[2]!);
      },
    });
    void approveFrom(app.host, digits);
    await expect(done).rejects.toThrow("became one of Ana's devices");
    expect(loadPairedMachine()?.person).toEqual(adopted);
    expect(loadMachine()?.device).toBeUndefined();
  });

  test("a computer holding only a person's cert counts as theirs", async () => {
    freshMachine();
    const user = `cli${++users}`;
    const jow = await withExchangeKey(await generateIdentity("Jow"));
    const app = desktop(jow, user);
    await app.host.poll();
    const first = login(user);
    await approveFrom(app.host, first.digits);
    await first.done;
    const m = loadPairedMachine();
    if (!m?.cert) throw new Error("the app didn't certify this computer");
    const certOnly: PairedMachine = { identity: m.identity, label: m.label, relay: m.relay, cert: m.cert };
    saveMachine(certOnly);
    await expect(login(user).done).rejects.toThrow(`is already one of someone's devices (key ${await personFingerprint(jow.pk)})`);
    await expect(loginComputer({ relay: "http://127.0.0.1:9", user, say: () => {}, confirm: async () => true })).rejects.toThrow("is already one of someone's devices");
    expect(loadPairedMachine()).toEqual(certOnly);
  });
});

describe("kiwi login enrolls a computer (T637)", () => {
  test("it asks, prints the digits the person types in the app, and keeps the device list", async () => {
    freshMachine();
    const user = `cli${++users}`;
    const person = await withExchangeKey(await generateIdentity("Jow"));
    const app = desktop(person, user);
    await app.host.poll();
    const run = login(user);
    await approveFrom(app.host, run.digits);
    const device = await run.done;

    const m = loadMachine()!;
    expect(m.device).toEqual(device);
    expect(device.person).toEqual({ name: "Jow", pk: person.pk, xpk: person.xpk! });
    const read = await readDeviceList(device.links);
    expect(read.ok && read.list.devices.find((d) => d.device === m.identity.pk)).toMatchObject({ as: "computer", approve: false });
    expect(run.lines.at(-1)).toContain("is one of Jow's devices now");
  });

  test("the app holding the person key certifies it too, so the app can start agents there", async () => {
    freshMachine();
    const user = `cli${++users}`;
    const person = await withExchangeKey(await generateIdentity("Jow"));
    const app = desktop(person, user);
    await app.host.poll();
    const run = login(user);
    await approveFrom(app.host, run.digits);
    await run.done;

    const m = loadMachine() as MachineFile & { cert?: MachineCert; person?: { pk: string } };
    expect(m.cert).toMatchObject({ machine: m.identity.pk, pk: person.pk, label: m.label });
    expect(m.person?.pk).toBe(person.pk);
    expect(app.computers).toEqual([expect.objectContaining({ machinePk: m.identity.pk, personPk: person.pk, label: m.label })]);
    expect(run.lines.at(-1)).toContain("your app can start agents here");
  });

  test("its agents join the person's channels on their own, from this computer", async () => {
    freshMachine();
    const user = `cli${++users}`;
    const s = await setupChannel(rooms.url.origin);
    const person = await withExchangeKey(s.person);
    const app = desktop(person, user);
    await app.host.poll();
    const run = login(user);
    await approveFrom(app.host, run.digits);
    await run.done;

    const agent = await generateIdentity("atlas");
    const claims = await computerClaimFor(s.roomId, agent.pk);
    expect(claims?.computer?.cert).toMatchObject({ machine: loadMachine()!.identity.pk, pk: s.person.pk });
    const { requestId } = await Channel.requestJoin(rooms.url.origin, s.code, agent, { name: "atlas" }, claims);
    const req = (await s.ownerCh.requests({ person: s.person.pk })).find((r) => r.id === requestId);
    expect(req).toMatchObject({ kind: "agent", computer: { pk: loadMachine()!.identity.pk, person: s.person.pk, own: true, joinsOnItsOwn: true } });
    expect(req?.computer?.forgotten).toBeUndefined();

    await s.ownerCh.autoApprove(s.person.pk, [], []);
    await Channel.joinStatus(rooms.url.origin, s.code, agent, requestId);
    const approved = await s.ownerCh.autoApprove(s.person.pk, [], []);
    expect(approved.map((x) => x.pk)).toEqual([agent.pk]);
    const member = (await s.ownerCh.members()).find((x) => x.pk === agent.pk);
    expect(member).toMatchObject({ kind: "agent", from: { pk: loadMachine()!.identity.pk, label: loadMachine()!.label } });
    await s.ownerCh.close();
  });

  test("a dev relay needs the sign-in name", async () => {
    freshMachine();
    await expect(loginComputer({ relay, say: () => {}, confirm: async () => true })).rejects.toThrow(PairError);
    await expect(loginComputer({ relay, say: () => {}, confirm: async () => true })).rejects.toThrow("kiwi login --user");
  });

  test("an ask the app turns away ends the login", async () => {
    freshMachine();
    const user = `cli${++users}`;
    const person = await withExchangeKey(await generateIdentity("Jow"));
    const app = desktop(person, user);
    await app.host.poll();
    const run = login(user);
    let ask = await app.host.poll();
    while (!ask) {
      await Bun.sleep(50);
      ask = await app.host.poll();
    }
    await app.host.deny(ask.id);
    await expect(run.done).rejects.toThrow("turned");
    expect(loadMachine()?.device).toBeUndefined();
  });
});
