import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { MAX_BODY_LENGTH, PAGE_BYTES } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(120_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-history-bytes-"));
let server: ReturnType<typeof startRelay> | undefined;
let ch: Channel;
const bodies: string[] = [];

const noise = (bytes: number) => Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64");

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const relay = server.url.origin;
  const owner = await generateIdentity("boss");
  const { access } = await Channel.create(relay, owner, { name: "boss" });
  ch = new Channel(access, relay, owner);
  for (const size of [1_000, 60_000]) {
    const body = `${size}:${noise(size)}`;
    bodies.push(body);
    await ch.send(body);
  }
  for (let i = 0; i < 60; i++) {
    const body = `big${i}:${noise(70_000)}`;
    bodies.push(body);
    await ch.send(body);
  }
});

afterAll(() => {
  server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

describe("history is read in pages of bounded size, and nothing is skipped", () => {
  test("one page stops before its bytes pass the cap, but always carries at least one message", async () => {
    const page = await ch.page(0, 1000);
    expect(page.length).toBeGreaterThan(0);
    expect(page.length).toBeLessThan(bodies.length);
    const bytes = page.reduce((n, m) => n + m.body.length, 0);
    expect(bytes).toBeLessThanOrEqual(PAGE_BYTES);
  });

  test("history from the start returns every message, the large ones included", async () => {
    const { messages } = await ch.history(0);
    expect(messages.map((m) => m.body)).toEqual(bodies);
  });

  test("a single large message reads back from just before it", async () => {
    const { messages } = await ch.history(2);
    expect(messages[0]?.body).toBe(bodies[2]);
  });

  test("a message longer than every client accepts is refused when sent, not lost after", async () => {
    expect(ch.send("x".repeat(MAX_BODY_LENGTH + 1))).rejects.toThrow(/at most 100,000 characters/);
  });
});
