import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { saveConfig, saveIdentity, writeCursor } from "../src/config.ts";
import { daemonListening, daemonSock, startDaemon, stopDaemon, type Daemon } from "../src/daemon.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { checked } from "./check.ts";

setDefaultTimeout(60_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-seat-approval-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-seat-approval-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay> | undefined;
let daemon: Daemon | undefined;

afterAll(async () => {
  await daemon?.stop().catch(() => {});
  await stopDaemon(daemonSock(home)).catch(() => {});
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

const seatOf = async (agent: string) => (await daemonListening()).find((s) => s.channel === "test" && s.agent === agent) ?? null;

async function until(what: string, ok: () => Promise<boolean>, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

let ownerCh: Channel;
let relay = "";
let code = "";
let roomId = "";

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  const owner = await generateIdentity("human");
  const agent = await generateIdentity("claude");
  const made = await Channel.create(relay, owner, { name: "human" }, [{ ...agent, info: { name: "claude" } }]);
  ownerCh = new Channel(made.access, relay, owner);
  code = made.code;
  roomId = made.access.roomId;
  saveConfig({ channels: { test: { ...(await Channel.resume(relay, made.code, agent)), relay, code: made.code, as: "claude" } } });
  saveIdentity(agent, roomId);
  daemon = await startDaemon(undefined, { beaconMs: 300, listenerGraceMs: 0, retryFirstMs: 60_000 });
  await until("claude's seat", async () => (await seatOf("claude")) !== null, 15_000);
});

test("a key that waited for approval gets its seat once its join writes its cursor, not at its backed-off retry", async () => {
  const pending = await generateIdentity("slowpoke");
  const ask = await Channel.requestJoin(relay, code, pending, { name: "slowpoke" });
  saveIdentity(pending, roomId);
  await daemonListening();
  await Bun.sleep(2_500);
  expect(await seatOf("slowpoke")).toBeNull();
  await ownerCh.approve((await checked(ownerCh, relay, code, [{ id: pending, requestId: ask.requestId }]))[0]!);
  writeCursor("test", "slowpoke", 0);
  const approved = Date.now();
  await until("slowpoke's seat after its join wrote its cursor", async () => (await seatOf("slowpoke")) !== null, 15_000);
  expect(Date.now() - approved).toBeLessThan(8_000);
});
