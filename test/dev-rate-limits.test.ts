import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { signRequest } from "@kiwi/core/auth.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import { runAgent } from "../src/agent.ts";
import { startRelay } from "../src/relay/bun.ts";
import { OPEN_POLICY, policyFrom } from "../src/relay/policy.ts";
import { MESSAGES_PER_MINUTE, PAGES_PER_MINUTE } from "../src/relay/room.ts";

setDefaultTimeout(30_000);

const ROOT = resolve(import.meta.dir, "..");
const dirs: string[] = [];
const servers: { stop: (closeActive?: boolean) => void }[] = [];
afterAll(() => {
  for (const s of servers) s.stop(true);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function relay(opts: Parameters<typeof startRelay>[0] = {}): string {
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: tempDir("kiwi-dev-rate-limits-"), policy: OPEN_POLICY, ...opts });
  servers.push(server);
  return server.url.origin;
}

function proxyTo(origin: string): string {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (req) => {
      const url = new URL(req.url);
      const headers = new Headers(req.headers);
      headers.set("x-forwarded-for", "203.0.113.7");
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
      return fetch(new URL(url.pathname + url.search, origin), { method: req.method, headers, body });
    },
  });
  servers.push(server);
  return server.url.origin;
}

async function channel(origin: string): Promise<{ ch: Channel; owner: Identity; roomId: string }> {
  const owner = await generateIdentity("human");
  const { access } = await Channel.create(origin, owner, { name: "human" });
  return { ch: new Channel(access, origin, owner), owner, roomId: access.roomId };
}

async function rawPost(origin: string, owner: Identity, roomId: string): Promise<number> {
  const body = JSON.stringify({ iv: "x", ct: "y" });
  const auth = await signRequest(owner, roomId, "POST", "/messages", body);
  const res = await fetch(new URL(`/v1/rooms/${roomId}/messages`, origin), { method: "POST", body, headers: { "content-type": "application/json", authorization: `Bearer ${auth}` } });
  return res.status;
}

function runFlag(hostname: string): Promise<{ code: number | null; out: string }> {
  const data = tempDir("kiwi-dev-rate-flag-");
  const p = spawn("bun", ["src/relay/bun.ts", "--hostname", hostname, "--port", "0", "--data", data, "--no-web", "--dev-no-rate-limits"], { cwd: ROOT });
  let out = "";
  const take = (d: Buffer) => {
    out += d.toString("utf8");
    if (out.includes("site:")) p.kill();
  };
  p.stdout.on("data", take);
  p.stderr.on("data", take);
  return new Promise((ok) => p.on("exit", (code) => ok({ code, out })));
}

const dev = relay({ devNoRateLimits: true });

test("a member on this machine posts and reads past the per-minute caps over HTTP, with no Retry-After wait", async () => {
  const { ch } = await channel(dev);
  const started = Date.now();
  for (let i = 0; i <= MESSAGES_PER_MINUTE; i++) await ch.send(`n${i}`);
  for (let i = 0; i <= PAGES_PER_MINUTE; i++) await ch.history(0);
  expect(Date.now() - started).toBeLessThan(20_000);
  expect((await ch.history(0)).messages.filter((m) => m.body.startsWith("n")).length).toBe(MESSAGES_PER_MINUTE + 1);
});

test("a member on this machine posts past the cap over the socket too", async () => {
  const { ch } = await channel(dev);
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

test("a request a proxy passed on keeps the caps, even on a relay started without them", async () => {
  const through = proxyTo(dev);
  const { ch, owner, roomId } = await channel(through);
  for (let i = 0; i < MESSAGES_PER_MINUTE; i++) await ch.send(`p${i}`);
  expect(await rawPost(through, owner, roomId)).toBe(429);
});

test("a policy alone can't lift the caps, and the option is refused off loopback", async () => {
  const plain = relay({ policy: { ...OPEN_POLICY, noRateLimits: true } });
  const { ch, owner, roomId } = await channel(plain);
  for (let i = 0; i < MESSAGES_PER_MINUTE; i++) await ch.send(`q${i}`);
  expect(await rawPost(plain, owner, roomId)).toBe(429);
  expect(() => startRelay({ port: 0, hostname: "0.0.0.0", dataDir: tempDir("kiwi-dev-rate-open-"), devNoRateLimits: true })).toThrow("devNoRateLimits needs hostname 127.0.0.1");
});

test("only the Bun relay's flag on localhost turns the caps off: never the environment", async () => {
  expect("noRateLimits" in policyFrom({ ...process.env, KIWI_NO_RATE_LIMITS: "1", KIWI_DEV_NO_RATE_LIMITS: "1" })).toBe(false);
  const refused = await runFlag("0.0.0.0");
  expect(refused.code).toBe(2);
  expect(refused.out).toContain("--dev-no-rate-limits lets one member flood a channel");
  const local = await runFlag("127.0.0.1");
  expect(local.out).toContain("rate limits: DEV: off for requests made on this machine, not through a proxy");
});
