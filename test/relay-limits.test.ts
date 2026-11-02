import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { signRequest } from "@kiwi/core/auth.ts";
import { fetchRelay, Relay } from "@kiwi/core/client.ts";
import { startRelay } from "../src/relay/bun.ts";
import { headOf } from "../src/relay/github-app.ts";
import { MAX_REQUEST_BYTES } from "../src/relay/http.ts";
import { setupChannel } from "./owner.ts";

setDefaultTimeout(30_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-relay-limits-"));
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

function chunked(text: string, size: number, after?: () => void): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  return new ReadableStream({
    pull(c) {
      if (at >= bytes.length) {
        after?.();
        c.close();
        return;
      }
      c.enqueue(bytes.subarray(at, at + size));
      at += size;
    },
  });
}

describe("the relay's limits", () => {
  test("an unsigned body over the cap is refused at the door, a signed one with 413 before any route reads it", async () => {
    const s = await setupChannel(relay);
    const over = "x".repeat(MAX_REQUEST_BYTES + 1);
    const unsigned = await fetch(`${relay}/v1/rooms/${s.roomId}/messages`, { method: "POST", body: over });
    expect(unsigned.status).toBe(401);
    const signed = await fetch(`${relay}/v1/rooms/${s.roomId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${await signRequest(s.owner, s.roomId, "POST", "/messages", over)}` },
      body: over,
    });
    expect(signed.status).toBe(413);
    expect(await signed.json()).toEqual({ error: "request too large", tag: "TooLarge" });
  });

  test("history reads are rate-limited per member", async () => {
    const s = await setupChannel(relay);
    const read = () => {
      const request = (s.ownerCh as unknown as { core: { request: (path: string) => Effect.Effect<unknown, unknown, Relay> } }).core.request("/messages");
      return Effect.runPromise(Effect.provideService(request, Relay, fetchRelay));
    };
    for (let i = 0; i < 120; i++) await read();
    await expect(read()).rejects.toMatchObject({ status: 429 });
  });
});

describe("reading GitHub's answers in bounds", () => {
  test("a diff is read up to its cap and marked truncated, the rest never read", async () => {
    let drained = false;
    const { text, truncated } = await headOf(new Response(chunked("d".repeat(10_000), 100, () => void (drained = true))), 1_000);
    expect([text.length, truncated, drained]).toEqual([1_000, true, false]);
    expect(await headOf(new Response("small"), 1_000)).toEqual({ text: "small", truncated: false });
  });
});
