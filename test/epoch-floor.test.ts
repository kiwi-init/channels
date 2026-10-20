import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { Channel, fetchRelay, keepHeld, Relay } from "@kiwi/core/client.ts";
import type { CallInit, RelayApi } from "@kiwi/core/client/relay.ts";
import type { ChannelAccess } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { loadConfig, saveAccess, updateConfig } from "../src/config/file.ts";
import { startRelay } from "../src/relay/bun.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-epoch-floor-"));
const home = mkdtempSync(join(tmpdir(), "kiwi-epoch-floor-home-"));
const before = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;
let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  if (before === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = before;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

type Sent = { path: string; body: string };

function keysSay(epoch: number | null, sent: Sent[]): RelayApi {
  return {
    ...fetchRelay,
    call: <T>(relay: string, roomId: string, path: string, init: CallInit = {}, params: Record<string, string | number> = {}) => {
      sent.push({ path, body: init.body ?? "" });
      return Effect.map(fetchRelay.call<T>(relay, roomId, path, init, params), (data) => (path === "/keys" && epoch !== null ? ({ ...(data as object), epoch } as T) : data));
    },
  };
}

const via = <A, E>(fx: Effect.Effect<A, E, Relay>, relay: RelayApi): Promise<A> => Effect.runPromise(Effect.provideService(fx, Relay, relay));

const sealedUnder = (sent: Sent[]) => sent.filter((s) => s.path === "/messages").map((s) => (JSON.parse(s.body) as { e: number }).e);

async function afterRemoval(): Promise<{ code: string; ownerCh: Channel; stays: Channel }> {
  const owner = await generateIdentity("human");
  const made = await Channel.create(relay, owner, { name: "human" });
  const ownerCh = new Channel(made.access, relay, owner);
  const seat = async (name: string): Promise<{ id: Identity; ch: Channel }> => {
    const id = await generateIdentity(name);
    const ask = await Channel.requestJoin(relay, made.code, id, { name });
    await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id, requestId: ask.requestId }]))[0]!);
    const st = await Channel.joinStatus(relay, made.code, id, ask.requestId);
    return { id, ch: new Channel((st as { access: ChannelAccess }).access, relay, id) };
  };
  const stays = await seat("stays");
  const leaves = await seat("leaves");
  await ownerCh.remove(leaves.id.pk);
  await stays.ch.refreshKeys();
  return { code: made.code, ownerCh, stays: stays.ch };
}

describe("a member's epoch never goes back", () => {
  test("a relay that names the epoch from before a removal can't make a member seal under its key", async () => {
    const { stays } = await afterRemoval();
    expect(stays.access.epoch).toBe(1);
    const sent: Sent[] = [];
    const older = keysSay(0, sent);
    await via(stays.fx.refreshKeys(), older);
    expect(stays.access.epoch).toBe(1);
    expect(Object.keys(stays.access.keys).sort()).toEqual(["0", "1"]);
    expect(await via(stays.fx.send("after the removal"), older)).toBeGreaterThan(0);
    expect(sealedUnder(sent)).toEqual([1]);
  });

  test("a relay that names an epoch this member holds no key for doesn't move it either", async () => {
    const { stays } = await afterRemoval();
    const sent: Sent[] = [];
    const ahead = keysSay(99, sent);
    await via(stays.fx.refreshKeys(), ahead);
    expect(stays.access.epoch).toBe(1);
    await via(stays.fx.send("still here"), ahead);
    expect(sealedUnder(sent)).toEqual([1]);
  });

  test("joining back can't start a member past the newest key it holds", async () => {
    const { code, stays } = await afterRemoval();
    const access = await via(Channel.fx.resume(relay, code, stays.identity), keysSay(99, []));
    expect(access.epoch).toBe(1);
    expect(Object.keys(access.keys).sort()).toEqual(["0", "1"]);
  });

  test("a relay restored from before the last rotation gets one refresh, then a refusal that says why, and the owner can't rotate past it", async () => {
    const { ownerCh, stays } = await afterRemoval();
    const db = new Database(join(dataDir, `${stays.roomId}.sqlite`));
    db.run("UPDATE meta SET v = '0' WHERE k = 'epoch'");
    db.close();
    const sent: Sent[] = [];
    await expect(via(stays.fx.send("hello?"), keysSay(null, sent))).rejects.toThrow(
      "the relay is behind this channel's key (it says epoch 0, this device holds 1): it may have been restored from a backup",
    );
    expect(sealedUnder(sent)).toEqual([1, 1]);
    expect(sent.filter((s) => s.path === "/keys")).toHaveLength(1);
    expect(stays.access.epoch).toBe(1);
    await expect(ownerCh.rotate()).rejects.toThrow("next epoch is 1");
  });
});

describe("what this machine saves", () => {
  const roomId = "ab".repeat(16);
  const access = (epoch: number, keys: Record<string, string>): ChannelAccess => ({ roomId, ownerPk: "pk", ownerXpk: "xpk", epoch, keys });

  test("saving an older epoch keeps the newer one, and a key already saved for an epoch is never replaced", () => {
    updateConfig((cfg) => {
      cfg.channels.plans = { ...access(1, { "0": "k0", "1": "k1" }), relay: "http://127.0.0.1:9", code: "code" };
    });
    saveAccess("plans", access(0, { "0": "relay-k0" }));
    expect(loadConfig().channels.plans).toMatchObject({ epoch: 1, keys: { "0": "k0", "1": "k1" } });
    saveAccess("plans", access(9, {}));
    expect(loadConfig().channels.plans?.epoch).toBe(1);
    saveAccess("plans", access(2, { "1": "relay-k1", "2": "k2" }));
    expect(loadConfig().channels.plans).toMatchObject({ epoch: 2, keys: { "0": "k0", "1": "k1", "2": "k2" } });
  });

  test("joining again keeps the epoch and keys this machine holds over what the relay hands back", () => {
    const held = { epoch: 2, keys: { "0": "k0", "1": "k1", "2": "k2" } };
    expect(keepHeld(held, { epoch: 0, keys: { "0": "relay-k0" } })).toEqual(held);
    expect(keepHeld(held, { epoch: 7, keys: {} })).toEqual(held);
    expect(keepHeld(held, { epoch: Number.NaN, keys: {} })).toEqual(held);
    expect(keepHeld(held, { epoch: 3, keys: { "2": "relay-k2", "3": "k3" } })).toEqual({ epoch: 3, keys: { ...held.keys, "3": "k3" } });
  });
});
