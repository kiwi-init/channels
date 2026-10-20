import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relayPort, startLocalRelay } from "../scripts/local-relay.ts";

test("the port comes from the relay's listening line", () => {
  expect(relayPort("Kiwi Channels relay listening on http://127.0.0.1:41234/\n  sign-in: off\n  site: not served\n")).toBe(41234);
  expect(relayPort("Kiwi Channels relay listening on http://localhost:8787/")).toBe(8787);
  expect(relayPort("  site: not served\n")).toBeNull();
  expect(relayPort("Kiwi Channels relay listening on http://127.0.0.1:0/")).toBeNull();
});

test("two relays started at once each get a free port from the system, and answer on it", async () => {
  const data = mkdtempSync(join(tmpdir(), "kiwi-local-relay-"));
  const settled = await Promise.allSettled([startLocalRelay(join(data, "a"), null), startLocalRelay(join(data, "b"), null)]);
  const started = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  try {
    for (const r of settled) if (r.status === "rejected") throw r.reason;
    const [a, b] = started;
    expect(a!.port).not.toBe(b!.port);
    for (const { port } of started) expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBeLessThan(500);
  } finally {
    for (const { relay } of started) relay.kill();
    rmSync(data, { recursive: true, force: true });
  }
}, 30_000);
