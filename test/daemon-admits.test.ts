import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { claimComputer } from "@kiwi/core/person.ts";
import { daemonListening, daemonSock, startDaemon, stopDaemon, type Daemon, type PairedMachine } from "../src/daemon.ts";
import { saveMachine } from "../src/machine.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd, pairComputer, setupChannel, type OwnerSetup, type PairedComputer } from "./owner.ts";

setDefaultTimeout(90_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-admits-"));
const work = mkdtempSync(join(tmpdir(), "kiwi-admits-work-"));
const claudeDir = mkdtempSync(join(tmpdir(), "kiwi-admits-claude-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-admits-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay>;
let relay: string;
let s: OwnerSetup;
let pc: PairedComputer;
let daemon: Daemon | undefined;

async function until<T>(check: () => Promise<T | null | undefined | false>, label: string, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await check();
    if (got) return got;
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(100);
  }
}

async function ask(name: string): Promise<{ id: Identity; requestId: string }> {
  const id = await generateIdentity(name);
  const claim = await claimComputer(pc.machine, pc.cert, s.roomId, id.pk);
  const { requestId } = await Channel.requestJoin(relay, s.code, id, { name }, { computer: claim });
  return { id, requestId };
}

async function letIn(id: Identity, requestId: string): Promise<void> {
  await until(async () => (await Channel.joinStatus(relay, s.code, id, requestId)).status === "approved", `${id.name} let in`);
  const m = (await s.ownerCh.members()).find((x) => x.pk === id.pk);
  expect(m).toMatchObject({ name: id.name, kind: "agent", signedBy: pc.machine.pk, from: { pk: pc.machine.pk } });
  expect(m?.unverified).toBeUndefined();
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  s = await setupChannel(relay);
  pc = await pairComputer(s.person, "mac-mini");
  const paired: PairedMachine = { identity: pc.machine, label: "mac-mini", relay, cert: pc.cert, person: { pk: s.person.pk, xpk: s.person.xpk!, name: "owner" } };
  saveMachine(paired);
  await s.ownerCh.delegate({ pk: pc.machine.pk, xpk: pc.machine.xpk! }, s.person.pk);
});

afterAll(async () => {
  await daemon?.stop().catch(() => {});
  await stopDaemon(daemonSock(home));
  server.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  for (const d of [home, work, claudeDir, dataDir]) rmSync(d, { recursive: true, force: true });
});

test("with the owner's app closed, kiwi join on a delegated computer is let in by that computer's daemon", async () => {
  const p = Bun.spawn(kiwiCmd(["join", s.code, "--as", "bot", "--model", "test-model", "--timeout", "60s"]), {
    cwd: work,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, CLAUDECODE: "", CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: "" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect([await p.exited, err]).toEqual([0, expect.stringContaining("joined")]);
  expect(out).toContain("verification code");
  const bot = (await s.ownerCh.members()).find((m) => m.name === "bot");
  expect(bot).toMatchObject({ kind: "agent", signedBy: pc.machine.pk, from: { pk: pc.machine.pk, label: "mac-mini" }, sponsor: { user: s.person.pk } });
  expect(await s.ownerCh.requests({ person: s.person.pk })).toEqual([]);
  await stopDaemon(daemonSock(home));
});

test("a request made while the daemon was down is let in once it starts", async () => {
  const { id, requestId } = await ask("late");
  expect(await Channel.joinStatus(relay, s.code, id, requestId)).toEqual({ status: "pending", code: null });
  daemon = await startDaemon(home);
  await letIn(id, requestId);
});

test("a seat's request frame alone lets the next agent of this computer in", async () => {
  await until(async () => (await daemonListening(daemonSock(home))).some((x) => x.agent === "bot"), "bot's seat in the daemon");
  await until(async () => daemon!.admitting() === 0, "the daemon to stop looking");
  const { id, requestId } = await ask("framed");
  await letIn(id, requestId);
});

test("another computer's agent waits for the owner", async () => {
  const other = await pairComputer(s.person, "vps-1");
  const id = await generateIdentity("stray");
  const claim = await claimComputer(other.machine, other.cert, s.roomId, id.pk);
  const { requestId } = await Channel.requestJoin(relay, s.code, id, { name: "stray" }, { computer: claim });
  await Bun.sleep(3_000);
  expect(await Channel.joinStatus(relay, s.code, id, requestId)).toEqual({ status: "pending", code: null });
  expect((await s.ownerCh.members()).some((m) => m.pk === id.pk)).toBe(false);
});
