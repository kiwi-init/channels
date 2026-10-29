import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { readDeviceList, type DeviceLink } from "@kiwi/core/devices.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import type { MachineCert } from "@kiwi/core/person.ts";
import type { ComputerView } from "../desktop/src/bridge.ts";
import { createDeviceHost, type DeviceHost } from "../desktop/src/devices.ts";
import { loginComputer } from "../src/login.ts";
import { computerClaimFor, loadMachine, type MachineFile } from "../src/machine.ts";
import { PairError } from "../src/daemon/pair.ts";
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

async function approveFrom(host: DeviceHost, digits: Promise<string>): Promise<void> {
  let ask = await host.poll();
  while (!ask) {
    await Bun.sleep(50);
    ask = await host.poll();
  }
  await host.answer(ask.id);
  expect(await host.confirm(ask.id, await digits)).toEqual({ ok: true, label: ask.label });
}

function login(user: string) {
  const lines: string[] = [];
  let shown: (d: string) => void = () => {};
  const digits = new Promise<string>((r) => (shown = r));
  const done = loginComputer({
    relay,
    user,
    everyMs: 50,
    say: (line) => {
      lines.push(line);
      const m = /digits in your app: (\d{3}) (\d{3})/.exec(line);
      if (m) shown(m[1]! + m[2]!);
    },
  });
  return { done, digits, lines };
}

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
    await expect(loginComputer({ relay, say: () => {} })).rejects.toThrow(PairError);
    await expect(loginComputer({ relay, say: () => {} })).rejects.toThrow("kiwi login --user");
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
