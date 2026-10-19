import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { saveConfig, saveIdentity } from "../src/config.ts";
import { daemonSock, listenDaemon, startDaemon } from "../src/daemon.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(30_000);

async function joinedHome(relay: string): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "kiwi-daemon-orphan-"));
  process.env.KIWI_HOME = home;
  const owner = await generateIdentity("human");
  const agent = await generateIdentity("claude");
  const made = await Channel.create(relay, owner, { name: "human" }, [{ ...agent, info: { name: "claude" } }]);
  saveConfig({ channels: { test: { ...(await Channel.resume(relay, made.code, agent)), relay, code: made.code, as: "claude" } } });
  saveIdentity(agent, made.access.roomId);
  return home;
}

test("a daemon whose only relay is a local one that went away, with nobody connected, stops by itself", async () => {
  const prevHome = process.env.KIWI_HOME;
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-daemon-orphan-relay-"));
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const home = await joinedHome(server.url.origin);
  const daemon = await startDaemon(home, { tickMs: 100, orphanMs: 1_000 });
  try {
    await Bun.sleep(1_500);
    expect(existsSync(daemonSock(home))).toBe(true);
    server.stop(true);
    const stopped = await Promise.race([daemon.stopped.then(() => true), Bun.sleep(10_000).then(() => false)]);
    expect(stopped).toBe(true);
  } finally {
    await daemon.stop().catch(() => {});
    server.stop(true);
    if (prevHome === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("while someone is connected, a daemon whose local relay went away keeps running", async () => {
  const prevHome = process.env.KIWI_HOME;
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-daemon-orphan-relay-"));
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const home = await joinedHome(server.url.origin);
  const daemon = await startDaemon(home, { tickMs: 100, orphanMs: 1_000 });
  const sub = await listenDaemon("test", "claude", 0, { sock: daemonSock(home), noSpawn: true });
  try {
    server.stop(true);
    const stopped = await Promise.race([daemon.stopped.then(() => true), Bun.sleep(3_000).then(() => false)]);
    expect(stopped).toBe(false);
  } finally {
    sub.close();
    await daemon.stop().catch(() => {});
    if (prevHome === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});
