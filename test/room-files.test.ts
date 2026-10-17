// The Bun relay's room files (T109): a create that's refused leaves no file, so minting room ids
// can't fill the data folder; a real create keeps its file; a missing room never gets one.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { decodeJoinCode } from "@kiwi/core/crypto.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(30_000);
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-room-files-"));
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

const roomFiles = () => readdirSync(dataDir).filter((f) => /^[0-9a-f]{32}\.sqlite/.test(f));

test("refused creates leave no room file", async () => {
  const before = roomFiles().length;
  const someone = await generateIdentity("someone");
  for (let i = 0; i < 5; i++) {
    const room = i.toString(16).padStart(32, "a");
    // No signature at all.
    const bare = await fetch(`${relay}/v1/rooms/${room}/create`, { method: "POST", body: "{}" });
    expect(bare.status).toBeGreaterThanOrEqual(400);
    // Signed, but not a create the relay accepts.
    const body = JSON.stringify({ owner: { pk: someone.pk, xpk: someone.xpk, sig: "x" }, members: [] });
    const signed = await fetch(`${relay}/v1/rooms/${room}/create`, { method: "POST", headers: { authorization: `Bearer ${await signRequest(someone, room, "POST", "/create", body)}` }, body });
    expect(signed.status).toBe(400);
    expect(existsSync(join(dataDir, `${room}.sqlite`))).toBe(false);
  }
  expect(roomFiles().length).toBe(before);
});

test("a real create keeps its file, and asking about a missing room makes none", async () => {
  const owner = await generateIdentity("owner");
  const { code } = await Channel.create(relay, owner, { name: "owner" });
  expect(existsSync(join(dataDir, `${decodeJoinCode(code).roomId}.sqlite`))).toBe(true);
  const missing = "f".repeat(32);
  for (let i = 0; i < 3; i++) expect((await fetch(`${relay}/v1/rooms/${missing}/info?fp=x`)).status).toBe(404);
  expect(existsSync(join(dataDir, `${missing}.sqlite`))).toBe(false);
});

test("a create on a legacy room (no owner) is answered as a missing room, and the room is wiped", async () => {
  const room = "c".repeat(32);
  const legacy = new Database(join(dataDir, `${room}.sqlite`), { create: true });
  legacy.run("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  legacy.close();
  const someone = await generateIdentity("someone");
  const body = "{}";
  const res = await fetch(`${relay}/v1/rooms/${room}/create`, { method: "POST", headers: { authorization: `Bearer ${await signRequest(someone, room, "POST", "/create", body)}` }, body });
  expect(res.status).toBe(404);
  expect(((await res.json()) as { tag: string }).tag).toBe("ChannelGone");
  expect(existsSync(join(dataDir, `${room}.sqlite`))).toBe(false);
});
