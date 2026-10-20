import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { Channel, fetchRelay, Relay } from "@kiwi/core/client.ts";
import { ChannelCore } from "@kiwi/core/client/core.ts";
import { newestEpoch, sealFor, stale } from "@kiwi/core/client/sealed.ts";
import { newChannelKey, open, seal, type ChannelAccess } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign, type Identity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-sealed-epoch-"));
let server: ReturnType<typeof startRelay>;
let relay: string;

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

function put(roomId: string, key: string, value: string): void {
  const db = new Database(join(dataDir, `${roomId}.sqlite`));
  db.run("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [key, value]);
  db.close();
}

interface Seat {
  id: Identity;
  ch: Channel;
}

async function room(title: string): Promise<{ owner: Identity; ownerCh: Channel; stays: Seat; leaves: Seat }> {
  const owner = await generateIdentity("human");
  const made = await Channel.create(relay, owner, { name: "human" }, [], undefined, null, title);
  const ownerCh = new Channel(made.access, relay, owner);
  const seat = async (name: string): Promise<Seat> => {
    const id = await generateIdentity(name);
    const ask = await Channel.requestJoin(relay, made.code, id, { name });
    await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id, requestId: ask.requestId }]))[0]!);
    const st = await Channel.joinStatus(relay, made.code, id, ask.requestId);
    return { id, ch: new Channel((st as { access: ChannelAccess }).access, relay, id) };
  };
  return { owner, ownerCh, stays: await seat("stays"), leaves: await seat("leaves") };
}

const opens = (key: string, roomId: string, blob: { iv: string; ct: string } | null | undefined) => (blob ? open(key, roomId, blob.iv, blob.ct).catch(() => null) : Promise.resolve(null));

function ownerPut(ch: Channel, path: string, body: unknown): Promise<unknown> {
  const request = (ch as unknown as { core: { request: (path: string, init: RequestInit) => Effect.Effect<unknown, unknown, Relay> } }).core.request(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return Effect.runPromise(Effect.provideService(request, Relay, fetchRelay));
}

describe("the title and settings follow the channel's epoch", () => {
  test("a removal reseals them under the new key: the removed member opens neither, a member who stayed opens both", async () => {
    const { ownerCh, stays, leaves } = await room("plans");
    await ownerCh.setCharter({ text: "ship it", since: 1 });
    await ownerCh.setHold({ on: true, note: "wait for jow", since: 2 });
    const kept = { ...leaves.ch.access.keys };
    expect(Object.keys(kept)).toEqual(["0"]);
    await ownerCh.remove(leaves.id.pk);

    const info = await new Channel(ownerCh.access, relay, ownerCh.identity).info();
    expect(info.sealedEpoch).toBe(true);
    expect(info.title?.e).toBe(1);
    expect(info.settings?.e).toBe(1);
    expect(await opens(kept["0"]!, ownerCh.roomId, info.title)).toBeNull();
    expect(await opens(kept["0"]!, ownerCh.roomId, info.settings)).toBeNull();
    expect(await leaves.ch.title()).toBeNull();
    expect(await leaves.ch.guard()).toBeNull();

    const stale = new Channel({ ...stays.ch.access }, relay, stays.id);
    expect(Object.keys(stale.access.keys)).toEqual(["0"]);
    expect(await stale.title()).toBe("plans");
    const floor = await stale.guard();
    expect(floor?.charter?.text).toBe("ship it");
    expect(floor?.hold).toMatchObject({ on: true, note: "wait for jow" });
  });

  test("what the owner changes after a removal is sealed under the newest key", async () => {
    const { ownerCh, leaves } = await room("plans");
    const kept = { ...leaves.ch.access.keys };
    await ownerCh.remove(leaves.id.pk);
    await ownerCh.setHold({ on: true, note: "paused", since: 3 });
    await ownerCh.setTitle("plans v2");
    const info = await new Channel(ownerCh.access, relay, ownerCh.identity).info();
    expect(info.settings?.e).toBe(1);
    expect(info.title?.e).toBe(1);
    expect(await opens(kept["0"]!, ownerCh.roomId, info.settings)).toBeNull();
    expect(await opens(kept["0"]!, ownerCh.roomId, info.title)).toBeNull();
    expect(await ownerCh.title()).toBe("plans v2");
  });

  test("the relay refuses a title or settings sealed under a key the channel doesn't have, or an older one", async () => {
    const { ownerCh, leaves } = await room("plans");
    const blob = await seal(ownerCh.access.keys["0"]!, ownerCh.roomId, await sign(ownerCh.identity, { what: "channel-title", room: ownerCh.roomId, name: "x" }));
    await expect(ownerPut(ownerCh, "/title", { title: { e: 3, ...blob } })).rejects.toMatchObject({ status: 400 });
    await ownerCh.remove(leaves.id.pk);
    await expect(ownerPut(ownerCh, "/title", { title: blob })).rejects.toMatchObject({ status: 400 });
    await expect(ownerPut(ownerCh, "/settings", { settings: { e: 0, ...blob } })).rejects.toMatchObject({ status: 400 });
    expect(await ownerCh.title()).toBe("plans");
  });

  test("an owner's app reseals what a rotation before this change left under an older key", async () => {
    const { ownerCh, leaves } = await room("plans");
    await ownerCh.setCharter({ text: "old rules", since: 1 });
    await ownerCh.remove(leaves.id.pk);
    const key0 = ownerCh.access.keys["0"]!;
    put(ownerCh.roomId, "title", JSON.stringify(await seal(key0, ownerCh.roomId, await sign(ownerCh.identity, { what: "channel-title", room: ownerCh.roomId, name: "plans" }))));
    put(
      ownerCh.roomId,
      "settings",
      JSON.stringify(await seal(key0, ownerCh.roomId, await sign(ownerCh.identity, { what: "channel-settings", room: ownerCh.roomId, charter: { text: "old rules", since: 1 } }))),
    );
    put(ownerCh.roomId, "info_rev", crypto.randomUUID());
    const app = new Channel(ownerCh.access, relay, ownerCh.identity);
    expect((await app.info()).title?.e).toBeUndefined();
    expect(await app.rotateIfDue()).toBe(false);
    const info = await new Channel(ownerCh.access, relay, ownerCh.identity).info();
    expect([info.title?.e, info.settings?.e]).toEqual([1, 1]);
    expect(await opens(key0, ownerCh.roomId, info.title)).toBeNull();
    expect(await app.title()).toBe("plans");
    expect((await app.guard())?.charter?.text).toBe("old rules");
  });
});

describe("sealing rules", () => {
  const access = (keys: Record<string, string>): ChannelAccess => ({ roomId: "ab".repeat(16), ownerPk: "pk", epoch: 0, keys }) as ChannelAccess;

  test("the newest key the client holds, whatever the relay says", () => {
    expect(newestEpoch({ "0": "a", "2": "b", "1": "c" })).toBe(2);
    expect(newestEpoch({ "0": "a", x: "b", "-1": "c" })).toBe(0);
    expect(newestEpoch({})).toBe(0);
  });

  test("a relay that doesn't keep the epoch gets the epoch-0 seal it always had", async () => {
    const id = await generateIdentity("human");
    const k0 = newChannelKey();
    const k1 = newChannelKey();
    const core = new ChannelCore(access({ "0": k0, "1": k1 }), relay, id);
    const old = await Effect.runPromise(Effect.provideService(sealFor(core, { epoch: 1, sealedEpoch: false }, { a: 1 }), Relay, fetchRelay));
    expect(old && "e" in old).toBe(false);
    expect(await opens(k0, core.roomId, old)).toEqual({ a: 1 });
    const now = await Effect.runPromise(Effect.provideService(sealFor(core, { epoch: 1, sealedEpoch: true }, { a: 1 }), Relay, fetchRelay));
    expect(now?.e).toBe(1);
    expect(await opens(k1, core.roomId, now)).toEqual({ a: 1 });
  });

  test("a blob under an older key than the newest is stale, only on a relay that keeps the epoch", () => {
    const keys = { "0": "a", "1": "b" };
    expect(stale({ sealedEpoch: true, title: { iv: "i", ct: "c" }, settings: null }, keys)).toBe(true);
    expect(stale({ sealedEpoch: true, title: { e: 1, iv: "i", ct: "c" }, settings: { e: 1, iv: "i", ct: "c" } }, keys)).toBe(false);
    expect(stale({ sealedEpoch: false, title: { iv: "i", ct: "c" }, settings: null }, keys)).toBe(false);
  });
});
