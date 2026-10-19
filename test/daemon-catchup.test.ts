import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { saveConfig, saveIdentity } from "../src/config.ts";
import { listenDaemon, startDaemon, type Daemon, type DaemonSubscription } from "../src/daemon.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-daemon-catchup-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-daemon-catchup-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay> | undefined;
let ownerCh: Channel;
let daemon: Daemon | undefined;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const relay = server.url.origin;
  const owner = await generateIdentity("human");
  const agent = await generateIdentity("claude");
  const made = await Channel.create(relay, owner, { name: "human" }, [{ ...agent, info: { name: "claude" } }]);
  ownerCh = new Channel(made.access, relay, owner);
  saveConfig({ channels: { test: { ...(await Channel.resume(relay, made.code, agent)), relay, code: made.code, as: "claude" } } });
  saveIdentity(agent, made.access.roomId);
  daemon = await startDaemon();
});

afterAll(async () => {
  await daemon?.stop().catch(() => {});
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

async function collect(sub: DaemonSubscription, want: number, ms = 20_000): Promise<Message[]> {
  const got: Message[] = [];
  const it = sub[Symbol.asyncIterator]();
  const end = Date.now() + ms;
  while (got.length < want) {
    const next = await Promise.race([it.next(), Bun.sleep(Math.max(1, end - Date.now())).then(() => null)]);
    if (!next || next.done) break;
    got.push(next.value);
  }
  return got;
}

test("a message that lands while a subscriber catches up doesn't skip the rest of the catch-up", async () => {
  const warm = await listenDaemon("test", "claude", 0, { noSpawn: true });
  warm.close();
  const seqs: number[] = [];
  for (let i = 0; i < 30; i++) seqs.push(await ownerCh.send(`backlog ${i} ${"x".repeat(60_000)}`));
  const subscribing = listenDaemon("test", "claude", (seqs[0] ?? 1) - 1, { noSpawn: true });
  seqs.push(await ownerCh.send("live during the catch-up"));
  const sub = await subscribing;
  const got = await collect(sub, seqs.length);
  sub.close();
  expect(got.map((m) => m.seq)).toEqual(seqs);
});
