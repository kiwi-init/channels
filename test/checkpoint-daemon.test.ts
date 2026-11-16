import { afterAll, beforeAll, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { saveConfig, saveIdentity } from "../src/config.ts";
import { listenDaemon, startDaemon, type Daemon } from "../src/daemon.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { fold } from "@kiwi/core/state.ts";
import { startRelay } from "../src/relay/bun.ts";
import { OPEN_POLICY } from "../src/relay/policy.ts";

setDefaultTimeout(60_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-ckpt-daemon-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-ckpt-daemon-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

const DUE = Date.parse("2026-11-16T21:00:00Z");

let server: ReturnType<typeof startRelay> | undefined;
let ownerCh: Channel;
let daemon: Daemon | undefined;

beforeAll(async () => {
  setSystemTime(DUE - 120_000);
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, policy: OPEN_POLICY });
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
  setSystemTime();
  await daemon?.stop().catch(() => {});
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

test("the daemon answers the relay's checkpoint signal with the daily request, built from its own board", async () => {
  await ownerCh.send("", { kind: "event", ev: { op: "task.add", title: "Ship it", owner: "claude" } });
  await ownerCh.setCheckpointDaily({ at: "18:00", tz: "America/Sao_Paulo" });
  const sub = await listenDaemon("test", "claude", 0, { noSpawn: true });
  try {
    await Bun.sleep(500);
    setSystemTime(DUE + 1000);
    server!.fireCheckpoint(ownerCh.roomId);
    let asks: ReturnType<typeof fold>["checkpointAsks"] = [];
    for (let i = 0; i < 100 && !asks.length; i++) {
      await Bun.sleep(50);
      asks = fold((await ownerCh.history(0)).messages, await ownerCh.members()).checkpointAsks;
    }
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ by: "claude", occurrence: "2026-11-16T18:00", asks: [], unreachable: ["claude"] });
    expect((await ownerCh.checkpoints()).log).toEqual([{ id: "2026-11-16T18:00", due: DUE, state: "answered", seq: asks[0]!.seq }]);
  } finally {
    sub.close();
  }
});
