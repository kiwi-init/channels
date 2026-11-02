import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel, type PresenceFields } from "@kiwi/core/client.ts";
import { newChannelKey, type ChannelAccess } from "@kiwi/core/crypto.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { Presence } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { beaconFrame, ephSocket } from "./beacons.ts";

setDefaultTimeout(30_000);

const MIN = 60_000;
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-presence-fresh-"));
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";
let access: ChannelAccess;
let win: Identity;
let rogue: Identity;
let socket: Awaited<ReturnType<typeof ephSocket>> | undefined;
const heard: (Presence & { sigOk: boolean })[] = [];
const ctl = new AbortController();
let done = 0;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  const owner = await generateIdentity("lead");
  win = await generateIdentity("win");
  rogue = await generateIdentity("rogue");
  const made = await Channel.create(relay, owner, { name: "lead" }, [
    { ...win, info: { name: "win" } },
    { ...rogue, info: { name: "rogue" } },
  ]);
  access = made.access;
  const ch = new Channel(access, relay, owner);
  let ready = false;
  void ch.stream(await ch.head(), () => {}, { signal: ctl.signal, onReady: () => (ready = true), onPresence: (p) => void heard.push(p) }).catch(() => {});
  await until(() => ready, "the listener to open");
  socket = await ephSocket(relay, access.roomId, win);
});

afterAll(() => {
  ctl.abort();
  socket?.close();
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function until(pred: () => boolean, label: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(20);
  }
}

async function deliver(frames: string[]): Promise<(Presence & { sigOk: boolean })[]> {
  const from = heard.length;
  const mark = `done-${++done}`;
  for (const f of [...frames, await beaconFrame(access, win, { client: mark })]) socket!.send(f);
  await until(() => heard.some((p) => p.client === mark), "the last beacon");
  return heard.slice(from).filter((p) => p.client !== mark);
}

let base = 0;
const said = (got: (Presence & { sigOk: boolean })[]) => got.map((p) => `${p.client}@${p.ts - base}${p.sigOk ? "" : " unsigned"}`);

test("a fresh beacon is heard once: the same frame sent again, as a relay replaying it would, is dropped", async () => {
  base = Date.now();
  const fresh = await beaconFrame(access, win, { client: "replayed", ts: base });
  expect(said(await deliver([fresh, fresh, fresh]))).toEqual(["replayed@0"]);
  expect(said(await deliver([fresh]))).toEqual([]);
});

test("a beacon from more than five minutes ago or ahead is dropped; one within five minutes either way is heard", async () => {
  base = Date.now();
  const frames = await Promise.all([
    beaconFrame(access, win, { client: "stale", ts: base - 5 * MIN - 1_000 }),
    beaconFrame(access, win, { client: "ahead", ts: base + 5 * MIN + 1_000 }),
    beaconFrame(access, win, { client: "late", ts: base - 4 * MIN }),
    beaconFrame(access, win, { client: "early", ts: base + 4 * MIN }),
  ]);
  expect(said(await deliver(frames))).toEqual([`late@${-4 * MIN}`, `early@${4 * MIN}`]);
});

test("a key's beacon that isn't newer than its last one from that client is dropped, even with other fields; another client keeps its own", async () => {
  base = Date.now();
  const frames = await Promise.all([
    beaconFrame(access, win, { client: "web", ts: base }),
    beaconFrame(access, win, { client: "web", ts: base - 1_000 }),
    beaconFrame(access, win, { client: "web", ts: base, reach: "running" }),
    beaconFrame(access, win, { client: "mcp", ts: base - 1_000 }),
    beaconFrame(access, win, { client: "web", ts: base + 1_000 }),
  ]);
  expect(said(await deliver(frames))).toEqual(["web@0", "mcp@-1000", "web@1000"]);
});

test("a forged beacon carrying win's key, its time far ahead, never holds back win's own", async () => {
  base = Date.now();
  const frames = await Promise.all([beaconFrame(access, rogue, { from: "win", client: "forged", ts: base + 4 * MIN }, { pk: win.pk }), beaconFrame(access, win, { client: "forged", ts: base })]);
  expect(said(await deliver(frames))).toEqual([`forged@${4 * MIN} unsigned`, "forged@0"]);
});

test("a beacon sealed under an older epoch's key is dropped, though the listener still holds that key for history", async () => {
  const next: ChannelAccess = { ...access, epoch: access.epoch + 1, keys: { ...access.keys, [String(access.epoch + 1)]: newChannelKey() } };
  const got: (Presence & { sigOk: boolean })[] = [];
  const listening = new AbortController();
  let ready = false;
  const ch = new Channel(next, relay, win);
  void ch.stream(await ch.head(), () => {}, { signal: listening.signal, onReady: () => (ready = true), onPresence: (p) => void got.push(p) }).catch(() => {});
  await until(() => ready, "the next epoch's listener to open");
  socket!.send(await beaconFrame(access, rogue, { client: "departed" }));
  socket!.send(await beaconFrame(next, win, { client: "current" }));
  await until(() => got.some((p) => p.client === "current"), "the current epoch's beacon");
  listening.abort();
  expect(got.map((p) => p.client)).toEqual(["current"]);
});

test("beacons a live sender sends back to back are each heard", async () => {
  const ch = new Channel(access, relay, win);
  const sender = new AbortController();
  let beacon: ((p: PresenceFields) => Promise<void>) | null = null;
  void ch.stream(await ch.head(), () => {}, { signal: sender.signal, onOpen: ({ presence }) => (beacon = presence) }).catch(() => {});
  await until(() => beacon !== null, "the sender to open");
  const send = beacon!;
  const from = heard.length;
  for (let i = 0; i < 8; i++) await send({ client: "burst" });
  await until(() => heard.slice(from).filter((p) => p.client === "burst").length === 8, "every beacon of the burst");
  sender.abort();
});
