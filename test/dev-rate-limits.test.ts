import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import { runAgent } from "../src/agent.ts";
import { startRelay } from "../src/relay/bun.ts";
import { OPEN_POLICY, policyFrom } from "../src/relay/policy.ts";
import { MESSAGES_PER_MINUTE, PAGES_PER_MINUTE } from "../src/relay/room.ts";

setDefaultTimeout(30_000);

const ROOT = resolve(import.meta.dir, "..");
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-dev-rate-limits-"));
const relay = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, policy: { ...OPEN_POLICY, noRateLimits: true } });
afterAll(() => {
  relay.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function channel(): Promise<Channel> {
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(relay.url.origin, owner, { name: "human" });
  return new Channel(access, relay.url.origin, owner);
}

function runFlag(hostname: string): Promise<{ code: number | null; out: string }> {
  const data = mkdtempSync(join(tmpdir(), "kiwi-dev-rate-flag-"));
  const p = spawn("bun", ["src/relay/bun.ts", "--hostname", hostname, "--port", "0", "--data", data, "--no-web", "--dev-no-rate-limits"], { cwd: ROOT });
  let out = "";
  const take = (d: Buffer) => {
    out += d.toString("utf8");
    if (out.includes("site:")) p.kill();
  };
  p.stdout.on("data", take);
  p.stderr.on("data", take);
  return new Promise((ok) =>
    p.on("exit", (code) => {
      rmSync(data, { recursive: true, force: true });
      ok({ code, out });
    }),
  );
}

test("a member posts and reads past the per-minute caps over HTTP, with no Retry-After wait", async () => {
  const ch = await channel();
  const started = Date.now();
  for (let i = 0; i <= MESSAGES_PER_MINUTE; i++) await ch.send(`n${i}`);
  for (let i = 0; i <= PAGES_PER_MINUTE; i++) await ch.history(0);
  expect(Date.now() - started).toBeLessThan(20_000);
  expect((await ch.history(0)).messages.filter((m) => m.body.startsWith("n")).length).toBe(MESSAGES_PER_MINUTE + 1);
});

test("a member posts past the cap over the socket too", async () => {
  const ch = await channel();
  let ready = false;
  const fiber = Effect.runFork(
    Stream.runForEach(ch.fx.live(0, { presence: false, send: true }), (ev) => Effect.sync(() => void (ev._tag === "Ready" && (ready = true)))) as Effect.Effect<void, unknown, never>,
  );
  const end = Date.now() + 5_000;
  while (!ready && Date.now() < end) await Bun.sleep(10);
  expect(ready).toBe(true);
  const started = Date.now();
  for (let i = 0; i <= MESSAGES_PER_MINUTE; i++) await ch.send(`s${i}`);
  expect(Date.now() - started).toBeLessThan(20_000);
  await runAgent(Fiber.interrupt(fiber));
  expect((await ch.history(0)).messages.filter((m) => m.body.startsWith("s")).length).toBe(MESSAGES_PER_MINUTE + 1);
});

test("only the Bun relay's flag on localhost turns the caps off: never the environment", async () => {
  expect("noRateLimits" in policyFrom({ ...process.env, KIWI_NO_RATE_LIMITS: "1", KIWI_DEV_NO_RATE_LIMITS: "1" })).toBe(false);
  const refused = await runFlag("0.0.0.0");
  expect(refused.code).toBe(2);
  expect(refused.out).toContain("--dev-no-rate-limits lets one member flood a channel");
  const local = await runFlag("127.0.0.1");
  expect(local.out).toContain("rate limits: DEV: off (this machine only)");
});
