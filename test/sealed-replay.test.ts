import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { Channel, fetchRelay, Relay } from "@kiwi/core/client.ts";
import type { CallInit, RelayApi } from "@kiwi/core/client/relay.ts";
import type { SealedBlob } from "@kiwi/core/client/sealed.ts";
import { open, seal, type ChannelAccess } from "@kiwi/core/crypto.ts";
import { generateIdentity, sign, type Identity } from "@kiwi/core/identity.ts";
import { channelAccess, withAccess } from "../desktop/src/seats.ts";
import { loadConfig, saveAccess, updateConfig } from "../src/config/file.ts";
import { startRelay } from "../src/relay/bun.ts";
import { checked } from "./check.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-sealed-replay-"));
const home = mkdtempSync(join(tmpdir(), "kiwi-sealed-replay-home-"));
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

function put(roomId: string, key: string, value: string): void {
  const db = new Database(join(dataDir, `${roomId}.sqlite`));
  db.run("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [key, value]);
  db.close();
}

type Blobs = Partial<Record<"title" | "settings" | "icon", SealedBlob | null>>;

function relayThat(change: (path: string, data: unknown) => unknown): RelayApi {
  return {
    ...fetchRelay,
    call: <T>(relay: string, roomId: string, path: string, init: CallInit = {}, params: Record<string, string | number> = {}) =>
      Effect.map(fetchRelay.call<T>(relay, roomId, path, init, params), (data) => ((init.method ?? "GET") === "GET" ? change(path, data) : data) as T),
    conditional: <T>(relay: string, roomId: string, path: string, etag: string | null, init: CallInit = {}, params: Record<string, string | number> = {}) =>
      Effect.map(fetchRelay.conditional<T>(relay, roomId, path, etag, init, params), (got) => (got.fresh ? { ...got, data: change(path, got.data) as T } : got)),
  };
}

const serving = (blobs: Blobs): RelayApi => relayThat((path, data) => (path === "/info" || path === "/icon" ? { ...(data as object), ...blobs } : data));

const via = <A, E>(fx: Effect.Effect<A, E, Relay>, relay: RelayApi): Promise<A> => Effect.runPromise(Effect.provideService(fx, Relay, relay));

async function iconBlob(ch: Channel): Promise<SealedBlob | null> {
  let blob: SealedBlob | null = null;
  await via(
    ch.fx.icon(),
    relayThat((path, data) => {
      if (path === "/icon") blob = (data as { icon: SealedBlob | null }).icon;
      return data;
    }),
  );
  return blob;
}

async function signedAt(ch: Channel, blob: SealedBlob | null | undefined): Promise<unknown> {
  if (!blob) return undefined;
  const opened = (await open(ch.access.keys[String(blob.e ?? 0)]!, ch.roomId, blob.iv, blob.ct)) as { at?: unknown } | null;
  return opened?.at;
}

async function room(): Promise<{ owner: Identity; member: Identity; ownerCh: Channel; memberCh: Channel; memberAccess: ChannelAccess }> {
  const owner = await generateIdentity("human");
  const made = await Channel.create(relay, owner, { name: "human" }, [], undefined, null, "alpha");
  const ownerCh = new Channel(made.access, relay, owner);
  const member = await generateIdentity("win");
  const ask = await Channel.requestJoin(relay, made.code, member, { name: "win" });
  await ownerCh.approve((await checked(ownerCh, relay, made.code, [{ id: member, requestId: ask.requestId }]))[0]!);
  const st = await Channel.joinStatus(relay, made.code, member, ask.requestId);
  const memberAccess = (st as { access: ChannelAccess }).access;
  return { owner, member, ownerCh, memberCh: new Channel(memberAccess, relay, member), memberAccess };
}

describe("a relay that serves an older owner-signed blob", () => {
  test("the title: a member who read the newer one reads null, not the older name", async () => {
    const { member, ownerCh, memberCh, memberAccess } = await room();
    const alpha = (await ownerCh.info()).title;
    await ownerCh.setTitle("beta");
    const beta = (await ownerCh.info()).title;
    expect(Number(await signedAt(ownerCh, beta))).toBeGreaterThan(Number(await signedAt(ownerCh, alpha)));
    expect(await memberCh.title()).toBe("beta");
    expect(await via(memberCh.fx.title(), serving({ title: alpha }))).toBeNull();
    expect(await via(ownerCh.fx.title(), serving({ title: alpha }))).toBeNull();
    expect(await via(new Channel(memberAccess, relay, member).fx.title(), serving({ title: alpha }))).toBe("alpha");
    expect(await memberCh.title()).toBe("beta");
  });

  test("the settings: guard() and rooms() ignore the older blob, and the owner's change is refused with a reason", async () => {
    const { member, ownerCh, memberCh, memberAccess } = await room();
    await ownerCh.setRooms({ list: [{ id: "old", name: "old" }], since: 1 });
    await ownerCh.setHold({ on: false, since: 1 });
    const older = (await ownerCh.info()).settings;
    await ownerCh.setRooms({ list: [{ id: "new", name: "new" }], since: 2 });
    await ownerCh.setHold({ on: true, note: "wait for jow", since: 2 });
    await ownerCh.setCompress(true);
    expect((await memberCh.guard())?.hold).toMatchObject({ on: true, note: "wait for jow" });
    expect((await memberCh.rooms())?.list).toEqual([{ id: "new", name: "new" }]);
    expect(await memberCh.compress()).toBe(true);

    const replay = serving({ settings: older });
    expect(await via(memberCh.fx.guard(), replay)).toBeNull();
    expect(await via(memberCh.fx.rooms(), replay)).toBeNull();
    expect(await via(memberCh.fx.compress(), replay)).toBe(false);
    expect((await via(new Channel(memberAccess, relay, member).fx.guard(), replay))?.hold).toMatchObject({ on: false });

    await expect(via(ownerCh.fx.setHold({ on: false, since: 3 }), replay)).rejects.toThrow(
      "the relay is serving older settings than this device has already seen, so changing one now would bring the older ones back: that's the relay's doing; ask whoever runs it",
    );
    expect((await memberCh.guard())?.hold).toMatchObject({ on: true, note: "wait for jow" });
    expect((await memberCh.rooms())?.list).toEqual([{ id: "new", name: "new" }]);
  });

  test("the icon: a member reads null for the older one, and a cleared icon can't be brought back", async () => {
    const { member, ownerCh, memberCh, memberAccess } = await room();
    await ownerCh.setIcon({ kind: "emoji", emoji: "🦊" });
    const fox = await iconBlob(ownerCh);
    await ownerCh.setIcon({ kind: "emoji", emoji: "🌱" });
    const sprout = await iconBlob(ownerCh);
    expect(await memberCh.icon()).toEqual({ kind: "emoji", emoji: "🌱" });
    expect(await via(memberCh.fx.icon(), serving({ icon: fox }))).toBeNull();
    expect(await via(new Channel(memberAccess, relay, member).fx.icon(), serving({ icon: fox }))).toEqual({ kind: "emoji", emoji: "🦊" });

    await ownerCh.setIcon(null);
    expect(await iconBlob(ownerCh)).not.toBeNull();
    expect(await memberCh.icon()).toBeNull();
    expect(await via(memberCh.fx.icon(), serving({ icon: sprout }))).toBeNull();
    expect(await via(ownerCh.fx.icon(), serving({ icon: sprout }))).toBeNull();
  });

  test("a blob with no date, from an older owner app, is read only until a dated one has been seen", async () => {
    const { owner, member, ownerCh, memberAccess } = await room();
    const e = ownerCh.access.epoch;
    const key = ownerCh.access.keys[String(e)]!;
    const undated = async (payload: object): Promise<SealedBlob> => ({ e, ...(await seal(key, ownerCh.roomId, await sign(owner, payload))) });
    const old: Blobs = {
      title: await undated({ what: "channel-title", room: ownerCh.roomId, name: "legacy" }),
      settings: await undated({ what: "channel-settings", room: ownerCh.roomId, hold: { on: false, since: 1 } }),
      icon: await undated({ what: "channel-icon", room: ownerCh.roomId, icon: { kind: "emoji", emoji: "🐍" } }),
    };
    await ownerCh.setHold({ on: true, since: 2 });
    await ownerCh.setIcon({ kind: "emoji", emoji: "🦊" });

    const fresh = new Channel(memberAccess, relay, member);
    const replay = serving(old);
    expect(await via(fresh.fx.title(), replay)).toBe("legacy");
    expect((await via(fresh.fx.guard(), replay))?.hold).toMatchObject({ on: false });
    expect(await via(fresh.fx.icon(), replay)).toEqual({ kind: "emoji", emoji: "🐍" });
    expect([fresh.access.seenTitleAt, fresh.access.seenSettingsAt, fresh.access.seenIconAt]).toEqual([undefined, undefined, undefined]);

    expect(await fresh.title()).toBe("alpha");
    expect((await fresh.guard())?.hold).toMatchObject({ on: true });
    expect(await fresh.icon()).toEqual({ kind: "emoji", emoji: "🦊" });
    expect(await via(fresh.fx.title(), replay)).toBeNull();
    expect(await via(fresh.fx.guard(), replay)).toBeNull();
    expect(await via(fresh.fx.icon(), replay)).toBeNull();
  });
});

describe("the date a change is signed with", () => {
  test("an owner whose clock is behind still dates a change past the one it replaces, and past what it has seen", async () => {
    const { owner, ownerCh, memberCh } = await room();
    const alpha = (await ownerCh.info()).title;
    const e = ownerCh.access.epoch;
    const ahead = Date.now() + 86_400_000;
    const future = await sign(owner, { what: "channel-title", room: ownerCh.roomId, name: "from tomorrow", at: ahead });
    put(ownerCh.roomId, "title", JSON.stringify({ e, ...(await seal(ownerCh.access.keys[String(e)]!, ownerCh.roomId, future)) }));
    put(ownerCh.roomId, "info_rev", crypto.randomUUID());
    expect(await memberCh.title()).toBe("from tomorrow");

    await ownerCh.setTitle("today");
    expect(await signedAt(ownerCh, (await ownerCh.info()).title)).toBe(ahead + 1);
    expect(await memberCh.title()).toBe("today");

    await via(ownerCh.fx.setTitle("later today"), serving({ title: alpha }));
    expect(await signedAt(ownerCh, (await ownerCh.info()).title)).toBe(ahead + 2);
    expect(await memberCh.title()).toBe("later today");
  });
});

describe("what a device has seen, kept", () => {
  test("the marks reach onAccess, so a Channel built from saved access still refuses the older blobs", async () => {
    const { member, ownerCh, memberAccess } = await room();
    const alpha = (await ownerCh.info()).title;
    await ownerCh.setHold({ on: false, since: 1 });
    const older = (await ownerCh.info()).settings;
    await ownerCh.setIcon({ kind: "emoji", emoji: "🦊" });
    const fox = await iconBlob(ownerCh);
    await ownerCh.setTitle("beta");
    await ownerCh.setHold({ on: true, since: 2 });
    await ownerCh.setIcon({ kind: "emoji", emoji: "🌱" });

    let saved: ChannelAccess | null = null;
    const reader = new Channel(memberAccess, relay, member, (a) => void (saved = a));
    expect(await reader.title()).toBe("beta");
    expect((await reader.guard())?.hold?.on).toBe(true);
    expect(await reader.icon()).toEqual({ kind: "emoji", emoji: "🌱" });
    const kept = saved as ChannelAccess | null;
    expect(kept?.seenTitleAt).toBe(reader.access.seenTitleAt!);
    expect(kept?.seenSettingsAt).toBe(reader.access.seenSettingsAt!);
    expect(kept?.seenIconAt).toBe(reader.access.seenIconAt!);
    expect(Math.min(kept?.seenTitleAt ?? 0, kept?.seenSettingsAt ?? 0, kept?.seenIconAt ?? 0)).toBeGreaterThan(0);

    const later = new Channel(kept!, relay, member);
    const replay = serving({ title: alpha, settings: older, icon: fox });
    expect(await via(later.fx.title(), replay)).toBeNull();
    expect(await via(later.fx.guard(), replay)).toBeNull();
    expect(await via(later.fx.icon(), replay)).toBeNull();
  });

  test("saveAccess keeps the higher mark of what is saved and what comes in", () => {
    const roomId = "cd".repeat(16);
    const access = (marks: Partial<ChannelAccess>): ChannelAccess => ({ roomId, ownerPk: "pk", ownerXpk: "xpk", epoch: 0, keys: { "0": "k0" }, ...marks });
    updateConfig((cfg) => {
      cfg.channels.replay = { ...access({ seenTitleAt: 10, seenSettingsAt: 5 }), relay: "http://127.0.0.1:9", code: "code" };
    });
    saveAccess("replay", access({ seenTitleAt: 3, seenSettingsAt: 9, seenIconAt: 7 }));
    expect(loadConfig().channels.replay).toMatchObject({ seenTitleAt: 10, seenSettingsAt: 9, seenIconAt: 7 });
    saveAccess("replay", access({}));
    expect(loadConfig().channels.replay).toMatchObject({ seenTitleAt: 10, seenSettingsAt: 9, seenIconAt: 7 });
  });

  test("the app's key store keeps the higher marks and hands them back to the next Channel", () => {
    const access = (marks: Partial<ChannelAccess>): ChannelAccess => ({ roomId: "room1", ownerPk: "pk1", ownerXpk: "xpk1", epoch: 0, keys: { "0": "SECRET-k0" }, ...marks });
    const seat = { label: "c", pk: "pk1", sk: "SECRET-sk", code: "code1", roomId: "room1", access: access({ seenTitleAt: 10, seenIconAt: 4 }) };
    const [saved] = withAccess([seat], "code1", "pk1", access({ seenTitleAt: 2, seenSettingsAt: 6 }));
    expect(channelAccess(saved!)).toMatchObject({ seenTitleAt: 10, seenSettingsAt: 6, seenIconAt: 4 });
  });
});
