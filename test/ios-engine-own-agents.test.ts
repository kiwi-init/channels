import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { certifyMachine, claimComputer, type MachineCert } from "@kiwi/core/person.ts";
import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import { startMachineInbox } from "../src/daemon/inbox.ts";
import type { PairedMachine } from "../src/daemon/pair.ts";
import { remoteRunner } from "../src/daemon/remote.ts";
import { startRelay } from "../src/relay/bun.ts";
import type { Push, Reply } from "../ios/engine/wire.ts";

setDefaultTimeout(60_000);

const root = mkdtempSync(join(tmpdir(), "kiwi-ios-engine-"));

let server: ReturnType<typeof startRelay>;
let relay: string;
let owner: Identity;
let person: Identity;
let machine: Identity;
let cert: MachineCert;
let code: string;
let roomId: string;
let inbox: { stop(): void; close(): void };
let ownerCh: Channel;
const pushes: Push[] = [];
const kiwi = () => (globalThis as unknown as { kiwi: { ask(json: string): Promise<string>; listen(next: (p: Push) => void): void } }).kiwi;

async function ask<T>(request: Record<string, unknown>): Promise<T> {
  const reply = JSON.parse(await kiwi().ask(JSON.stringify(request))) as Reply;
  if (!reply.ok) throw new Error(reply.error);
  return reply.value as T;
}

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

async function agentAsks(name: string, from: { machine: Identity; cert: MachineCert }): Promise<Identity> {
  const id = await generateIdentity(name);
  const computer = await claimComputer(from.machine, from.cert, roomId, id.pk);
  const { requestId } = await Channel.requestJoin(relay, code, id, { name }, { computer });
  void (async () => {
    for (let i = 0; i < 400; i++) {
      if ((await Channel.joinStatus(relay, code, id, requestId).catch(() => null))?.status === "approved") return;
      await Bun.sleep(50);
    }
  })();
  return id;
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: join(root, "relay") });
  relay = server.url.origin;
  owner = await withExchangeKey(await generateIdentity("owner"));
  person = await withExchangeKey(await generateIdentity("person"));
  machine = await withExchangeKey(await generateIdentity("machine"));
  cert = await certifyMachine(person, { pk: machine.pk, xpk: machine.xpk!, label: "studio" });
  const made = await Channel.create(relay, owner, { name: owner.name, kind: "human", person: person.pk }, [], undefined, null);
  code = made.code;
  roomId = made.access.roomId;
  ownerCh = new Channel(made.access, relay, owner);
  const paired: PairedMachine = { identity: machine, label: "studio", relay, cert, person: { pk: person.pk, xpk: person.xpk!, name: "person" } };
  inbox = startMachineInbox({
    dir: root,
    machine: () => paired,
    checkMs: 100,
    listed: async () => false,
    unpaired: async () => {},
    run: remoteRunner({}),
  });
  await import("../ios/engine/main.ts");
  kiwi().listen((p) => pushes.push(p));
  const seat: ChannelIdentityView = {
    label: "studio work",
    idName: owner.name,
    pk: owner.pk,
    sk: owner.sk,
    xpk: owner.xpk!,
    xsk: owner.xsk!,
    roomId,
    code,
    access: made.access,
    at: Date.now(),
    name: "studio work",
  };
  expect(await ask<number>({ op: "start", saved: { relay, person: { name: "person", pk: person.pk, sk: person.sk, xpk: person.xpk!, xsk: person.xsk! }, seats: [seat] } })).toBe(1);
});

afterAll(async () => {
  await ask({ op: "start", saved: { relay, person: null, seats: [] } });
  await ownerCh.close();
  inbox.stop();
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

describe("the phone's engine lets in agents from the person's own computers", () => {
  test("the person's own computers' agents are let in, and anyone else's are left to the person", async () => {
    const other = await withExchangeKey(await generateIdentity("other"));
    const theirMachine = await withExchangeKey(await generateIdentity("their-machine"));
    const theirCert = await certifyMachine(other, { pk: theirMachine.pk, xpk: theirMachine.xpk!, label: "theirs" });
    await agentAsks("own-agent", { machine, cert });
    await agentAsks("their-agent", { machine: theirMachine, cert: theirCert });
    await until("the own agent in", async () => (await ownerCh.members()).some((m) => m.name === "own-agent" && m.active));
    await until("their agent announced", () => pushes.some((p) => p.type === "log" && p.line === "studio work: their-agent asks to join"));
    expect((await ownerCh.members()).some((m) => m.name === "their-agent")).toBe(false);
  });
});
