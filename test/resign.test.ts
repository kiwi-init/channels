// A request signed, then held past the signature's window before it reaches the relay (the
// machine slept in between): the client signs it again, once. Seen killing `kiwi tail` overnight.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AUTH_SKEW_MS } from "@kiwi/core/auth.ts";
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

/** The next `times` signatures carry a time from before the window (as if signed before a long sleep); the relay's clock is untouched. */
function staleSignatures(times: number): { signed: () => number; restore: () => void } {
  const real = Date.now;
  let left = times;
  let signed = 0;
  Date.now = () => {
    if (new Error().stack?.includes("signRequest")) {
      signed++;
      if (left > 0) {
        left--;
        return real() - AUTH_SKEW_MS - 60_000;
      }
    }
    return real();
  };
  return { signed: () => signed, restore: () => void (Date.now = real) };
}

async function channel(): Promise<Channel> {
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(server.url.origin, owner, { name: "human" });
  return new Channel(access, server.url.origin, owner);
}

test("a signature that expired before it was sent: signed again once, and the request goes through", async () => {
  const ch = await channel();
  const clock = staleSignatures(1);
  try {
    expect(await ch.send("after a long sleep")).toBeGreaterThan(0);
    expect(clock.signed()).toBe(2);
  } finally {
    clock.restore();
  }
});

test("only once: a second stale signature is refused as it always was", async () => {
  const ch = await channel();
  const clock = staleSignatures(2);
  try {
    const err = await ch.head().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RelayError);
    expect((err as RelayError).status).toBe(401);
    expect(clock.signed()).toBe(2);
  } finally {
    clock.restore();
  }
});

test("other refusals are not retried", async () => {
  const ch = await channel();
  // Someone holding the channel's access but whose key was never admitted.
  const outsider = new Channel((ch as unknown as { access: ConstructorParameters<typeof Channel>[0] }).access, server.url.origin, await generateIdentity("mallory"));
  const clock = staleSignatures(0);
  try {
    // The relay's 403 (not a member) reaches the caller as it always has, after one signature.
    await expect(outsider.head()).rejects.toThrow(/no longer a member/);
    expect(clock.signed()).toBe(1);
  } finally {
    clock.restore();
  }
});
