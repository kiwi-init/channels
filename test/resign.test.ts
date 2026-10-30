import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTH_SKEW_MS, signRequest, verifyRequest } from "@kiwi/core/auth.ts";
import { Channel, RelayError } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { startRelay } from "../src/relay/bun.ts";

const dataDir = mkdtempSync(join(tmpdir(), "mc-resign-"));
let server: ReturnType<typeof startRelay>;
beforeAll(() => void (server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir })));
afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

function staleSignatures(times: number): { url: string; signatures: () => string[]; stop: () => void } {
  let left = times;
  const seen: string[] = [];
  const door = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const auth = req.headers.get("authorization");
      if (auth) {
        seen.push(auth);
        if (left > 0) {
          left--;
          return Response.json({ error: "bad or expired signature" }, { status: 401 });
        }
      }
      const u = new URL(req.url);
      return fetch(new URL(u.pathname + u.search, server.url.origin), {
        method: req.method,
        headers: req.headers,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      });
    },
  });
  return { url: door.url.origin, signatures: () => seen, stop: () => door.stop(true) };
}

async function channel(relay: string): Promise<Channel> {
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(server.url.origin, owner, { name: "human" });
  return new Channel(access, relay, owner);
}

test("the relay refuses a signature from before its window, and takes one from inside it", async () => {
  const id = await generateIdentity("human");
  const token = await signRequest(id, "room", "GET", "/head");
  const ts = Number(token.split(".")[2]);
  expect(await verifyRequest(token, "room", "GET", "/head", "", ts + 1_000)).toBe(id.pk);
  expect(await verifyRequest(token, "room", "GET", "/head", "", ts + AUTH_SKEW_MS + 60_000)).toBeNull();
});

test("a signature that expired before it was sent: signed again once, and the request goes through", async () => {
  const relay = staleSignatures(1);
  try {
    const ch = await channel(relay.url);
    expect(await ch.send("after a long sleep")).toBeGreaterThan(0);
    expect(relay.signatures()).toHaveLength(2);
  } finally {
    relay.stop();
  }
});

test("only once: a second stale signature is refused as it always was", async () => {
  const relay = staleSignatures(2);
  try {
    const ch = await channel(relay.url);
    const err = await ch.head().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect((err as RelayError).status).toBe(401);
    expect(relay.signatures()).toHaveLength(2);
  } finally {
    relay.stop();
  }
});

test("other refusals are not retried: a key never admitted gets the relay's refusal after one signature", async () => {
  const relay = staleSignatures(0);
  try {
    const ch = await channel(relay.url);
    const unadmitted = new Channel((ch as unknown as { access: ConstructorParameters<typeof Channel>[0] }).access, relay.url, await generateIdentity("mallory"));
    await expect(unadmitted.head()).rejects.toThrow(/the owner closed this channel/);
    expect(relay.signatures()).toHaveLength(1);
  } finally {
    relay.stop();
  }
});
