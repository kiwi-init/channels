import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import type { HarnessRow } from "@kiwi/core/harnesses.ts";
import { generateIdentity, withExchangeKey, type Identity } from "@kiwi/core/identity.ts";
import { certifyMachine, claimComputer, type MachineCert } from "@kiwi/core/person.ts";
import type { LaunchedView } from "@kiwi/core/terminals.ts";
import type { ChannelIdentityView } from "../desktop/src/bridge.ts";
import type { PairedComputer } from "../desktop/src/remote.ts";
import { startMachineInbox } from "../src/daemon/inbox.ts";
import type { PairedMachine } from "../src/daemon/pair.ts";
import { remoteRunner } from "../src/daemon/remote.ts";
import type { LaunchRequest } from "../src/launch/wire.ts";
import { startRelay } from "../src/relay/bun.ts";
import type { HarnessChoice, Push, Reply } from "../ios/engine/wire.ts";

setDefaultTimeout(60_000);

const root = mkdtempSync(join(tmpdir(), "kiwi-ios-engine-"));
const project = join(root, "project");
mkdirSync(project, { recursive: true });
const claude: HarnessRow = { harness: "claude", path: "/usr/local/bin/claude", version: "2.1.0", start: true, wake: null, why: null, options: null };

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
const launched: LaunchRequest[] = [];
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

async function agentAsks(name: string, from: { machine: Identity; cert: MachineCert }, launch?: string): Promise<Identity> {
  const id = await generateIdentity(name);
  const computer = await claimComputer(from.machine, from.cert, roomId, id.pk);
  const { requestId } = await Channel.requestJoin(relay, code, id, { name }, { computer, ...(launch ? { launch } : {}) });
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
    run: remoteRunner({
      inventory: async () => [claude],
      folders: () => [project],
      launch: async (req) => {
        launched.push(req);
        await agentAsks(req.nick ?? "launched", { machine, cert }, req.launch);
        return { ok: true, launch: req.launch!, placed: { ok: true, place: "hosted", socket: "/tmp/kiwi-1/abc", window: "@1", pane: "%1" } };
      },
    }),
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

const launches = (from: number) => pushes.slice(from).filter((p) => p.type === "launch");

describe("the phone's engine starts agents on the person's own computers", () => {
  test("it lists their paired computers, what each can start and the folders it works in", async () => {
    await until("the computer online", async () => (await ask<PairedComputer[]>({ op: "computers" })).some((c) => c.key === machine.pk && c.online));
    expect(await ask<PairedComputer[]>({ op: "computers" })).toEqual([{ key: machine.pk, xpk: machine.xpk!, label: "studio", online: true, since: expect.any(Number), seenAt: expect.any(Number) }]);
    expect(await ask<{ harnesses: HarnessChoice[]; bypass: boolean }>({ op: "harnessesOn", computer: machine.pk })).toEqual({
      harnesses: [{ ...claude, name: "Claude Code", face: "claude-code", mono: false }],
      bypass: false,
    });
    expect(await ask<string[]>({ op: "foldersOn", computer: machine.pk, code })).toEqual([project]);
    await expect(ask({ op: "harnessesOn", computer: owner.pk })).rejects.toThrow("that isn't one of your computers");
    await expect(ask({ op: "foldersOn", computer: machine.pk, code: "not-a-channel" })).rejects.toThrow("this phone isn't in that channel");
  });

  test("a launch reaches the computer, and the phone follows it from asked to joined, letting its agent in", async () => {
    const from = pushes.length;
    const got = await ask<LaunchedView>({ op: "launch", code, computer: machine.pk, harness: "claude", folder: project, nick: "helper", model: "opus" });
    if (!got.ok) throw new Error(got.detail);
    expect(got).toEqual({ ok: true, launch: got.launch, place: "hosted", window: "@1" });
    expect(launched.at(-1)).toMatchObject({ harness: "claude", folder: realpathSync(project), code, relay, nick: "helper", launch: got.launch, model: "opus" });
    await until("the agent joined", () => launches(from).some((p) => p.type === "launch" && p.stage === "joined"));
    expect(launches(from)).toEqual([
      { type: "launch", code, launch: got.launch, stage: "asked", name: "helper" },
      { type: "launch", code, launch: got.launch, stage: "joined", name: "helper" },
    ]);
    expect((await ownerCh.members()).find((m) => m.name === "helper")).toMatchObject({ active: true, kind: "agent", sponsor: { user: person.pk } });
  });

  test("a launch the computer refuses comes back with its reason, and isn't followed", async () => {
    const got = await ask<LaunchedView>({ op: "launch", code, computer: machine.pk, harness: "claude", folder: root, nick: "nowhere" });
    expect(got).toEqual({ ok: false, why: "bad-request", detail: "that folder isn't one this computer starts agents in" });
    await expect(ask({ op: "launch", code, computer: machine.pk, harness: "not-a-harness", folder: project })).rejects.toThrow("that launch has something this phone can't send");
  });

  test("the person's own computers' agents are let in with no launch, and anyone else's are left to the person", async () => {
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
