import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { saveConfig, saveIdentity } from "../src/config.ts";
import { daemonPresence, startDaemon, type Daemon } from "../src/daemon.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { trafficProxy } from "./traffic.ts";

setDefaultTimeout(60_000);

const BEACON_MS = 200;
const home = mkdtempSync(join(tmpdir(), "kiwi-who-cached-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-who-cached-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay> | undefined;
let daemon: Daemon | undefined;
let relay = "";
let proxy: ReturnType<typeof trafficProxy> | undefined;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  relay = proxy.url;
  const owner = await generateIdentity("human");
  const claude = await generateIdentity("claude");
  const codex = await generateIdentity("codex");
  const made = await Channel.create(relay, owner, { name: "human" }, [
    { ...claude, info: { name: "claude" } },
    { ...codex, info: { name: "codex" } },
  ]);
  saveConfig({
    channels: {
      test: { ...(await Channel.resume(relay, made.code, claude)), relay, code: made.code, as: "claude" },
      other: { ...(await Channel.resume(relay, made.code, codex)), relay, code: made.code, as: "codex" },
    },
  });
  saveIdentity(claude, made.access.roomId);
  saveIdentity(codex, made.access.roomId);
  daemon = await startDaemon(home, { beaconMs: BEACON_MS });
});

afterAll(async () => {
  await daemon?.stop().catch(() => {});
  proxy?.stop();
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

async function who(): Promise<{ out: string; ms: number }> {
  const t0 = performance.now();
  const p = Bun.spawn(kiwiCmd(["-c", "test", "--as", "claude", "who"]), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, CLAUDECODE: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  expect(await p.exited).toBe(0);
  return { out, ms: performance.now() - t0 };
}

test("once the daemon has heard a beacon round, kiwi who answers from it without waiting on a probe", async () => {
  const end = Date.now() + 15_000;
  while (!(await daemonPresence("test", "claude"))?.presence.some((h) => h.presence.from === "codex")) {
    if (Date.now() > end) throw new Error("timed out waiting for the daemon to hear codex");
    await Bun.sleep(100);
  }
  await Bun.sleep(BEACON_MS + 5_200);
  proxy!.reset();
  const fast = await who();
  const traffic = proxy!.reset();
  console.log(`kiwi who from the daemon's presence: ${Math.round(fast.ms)}ms, ${traffic.sockets} sockets, ${traffic.http} http`);
  expect(fast.out).toContain("codex");
  expect(traffic.sockets).toBe(0);
});
