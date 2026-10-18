import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { saveConfig, saveIdentity } from "../src/config.ts";
import { daemonPeek, listenDaemon, startDaemon, type Daemon, type DaemonSubscription } from "../src/daemon.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-daemon-big-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-daemon-big-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay> | undefined;
let ownerCh: Channel;
let daemon: Daemon | undefined;
let roomId = "";

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const relay = server.url.origin;
  const owner = await generateIdentity("human");
  const agent = await generateIdentity("claude");
  const made = await Channel.create(relay, owner, { name: "human" }, [{ ...agent, info: { name: "claude" } }]);
  ownerCh = new Channel(made.access, relay, owner);
  saveConfig({ channels: { test: { ...(await Channel.resume(relay, made.code, agent)), relay, code: made.code, as: "claude" } } });
  saveIdentity(agent, made.access.roomId);
  roomId = made.access.roomId;
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

const big = (tag: string) => `${tag} ${"x".repeat(50_000)}`;

test("a catch-up with messages far past the socket's buffer arrives whole and in order", async () => {
  const bodies = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? big(`big ${i}`) : `small ${i} ${"y".repeat(400)}`));
  const seqs: number[] = [];
  for (const b of bodies) seqs.push(await ownerCh.send(b));
  const last = seqs.at(-1) ?? 0;
  const end = Date.now() + 20_000;
  while (((await daemonPeek("test", "claude", roomId))?.head ?? 0) < last) {
    if (Date.now() > end) throw new Error("timed out waiting for the daemon's seat to reach the last message");
    await Bun.sleep(50);
  }
  const sub = await listenDaemon("test", "claude", (seqs[0] ?? 1) - 1, { noSpawn: true });
  const got = await collect(sub, bodies.length);
  sub.close();
  expect(got.map((m) => m.seq)).toEqual(seqs);
  expect(got.map((m) => m.body)).toEqual(bodies);
});

test("big live messages one after another all arrive whole", async () => {
  const from = await ownerCh.send("mark");
  const sub = await listenDaemon("test", "claude", from, { noSpawn: true });
  const bodies = Array.from({ length: 6 }, (_, i) => big(`live ${i}`));
  for (const b of bodies) await ownerCh.send(b);
  const got = await collect(sub, bodies.length);
  sub.close();
  expect(got.map((m) => m.body)).toEqual(bodies);
});
