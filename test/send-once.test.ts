// A message the app is unsure it sent is delivered once, however often it is tried again.

import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-send-once-"));
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

const sendId = (): string => crypto.randomUUID().replaceAll("-", "");
const bodies = async (ch: Channel): Promise<string[]> => (await ch.history(0)).messages.filter((m) => m.kind === "msg").map((m) => m.body);

test("the ack is lost: a retry with the same send id lands on the first message, a new one is a new message", async () => {
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  try {
    const relay = server.url.origin;
    const owner = await generateIdentity("human");
    const { access } = await Channel.create(relay, owner, { name: "human" });
    const ch = new Channel(access, relay, owner);
    const id = sendId();
    const first = await ch.send("the deploy is done", { id, cid: id });
    expect(await ch.send("the deploy is done", { id, cid: id })).toBe(first);
    expect(await ch.send("the deploy is done", { id, cid: id })).toBe(first);
    const other = sendId();
    expect(await ch.send("the deploy is done", { id: other, cid: other })).toBeGreaterThan(first);
    expect(await bodies(ch)).toEqual(["the deploy is done", "the deploy is done"]);
    await expect(ch.send("x", { cid: "short" })).rejects.toThrow("a send id is");
  } finally {
    server.stop(true);
  }
});

test("sent while the relay is away, tried again when it is back, twice over: delivered once", async () => {
  let server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const port = server.port;
  const relay = server.url.origin;
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(relay, owner, { name: "human" });
  const ch = new Channel(access, relay, owner);
  const id = sendId();
  server.stop(true);
  await expect(ch.send("written offline", { id, cid: id })).rejects.toThrow();
  server = startRelay({ port, hostname: "127.0.0.1", dataDir });
  try {
    const [a, b] = await Promise.all([ch.send("written offline", { id, cid: id }), ch.send("written offline", { id, cid: id })]);
    expect(a).toBe(b);
    expect(await ch.send("written offline", { id, cid: id })).toBe(a);
    expect(await bodies(ch)).toEqual(["written offline"]);
  } finally {
    server.stop(true);
  }
});
