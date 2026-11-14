import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { daemonListeners, daemonListening, daemonSock, stopDaemon } from "../src/daemon.ts";
import { hooksFixture } from "./hooks-fixture.ts";

setDefaultTimeout(90_000);

const fixture = hooksFixture({ prefix: "kiwi-once", sessionId: "once", channel: "once", transport: { kind: "direct" } });
const { agent, owner, ok, until, spawn, env: S, input: INPUT } = fixture;
let me = "";

const listening = () =>
  daemonListeners(daemonSock(agent))
    .then((ls) => ls.some((l) => l.kind === "hook" && l.agent === me))
    .catch(() => false);

beforeAll(async () => {
  await fixture.start();
  me = fixture.me;
  await until(async () => (await daemonListening(daemonSock(agent)).catch(() => [])).some((s) => s.agent === me), "the daemon holding the seat");
});

afterAll(() => fixture.dispose());

for (const event of ["prompt", "stop"] as const) {
  test(`a message the ${event} hook hands over doesn't wake the session again from the listener started with it`, async () => {
    await ok(owner, ["send", "--to", me, `before the ${event}`]);
    const listener = spawn(agent, ["hook", "listen"], S, INPUT);
    const handed = await ok(agent, ["hook", event], S, INPUT);
    expect(handed).toContain(`before the ${event}`);
    await until(listening, "the listener's slot");
    const early = await Promise.race([listener.exited, Bun.sleep(3_000).then(() => null)]);
    expect(early).toBeNull();
    await ok(owner, ["send", "--to", me, `after the ${event}`]);
    expect(await listener.exited).toBe(2);
    const woke = await new Response(listener.stderr).text();
    expect(woke).toContain(`after the ${event}`);
    expect(woke).not.toContain(`before the ${event}`);
    await ok(agent, ["hook", "prompt"], S, INPUT);
  });
}

test("a prompt hook whose output never reaches the session leaves the message unread for the next one", async () => {
  await ok(owner, ["send", "--to", me, "never printed"]);
  const cut = spawn(agent, ["hook", "prompt"], S, INPUT);
  await cut.stdout.cancel();
  await cut.exited;
  expect(await ok(agent, ["hook", "prompt"], S, INPUT)).toContain("never printed");
});

test("a hand-over cut at its size limit leaves the rest unread, and the next hook brings it", async () => {
  for (let i = 0; i < 10; i++) await ok(owner, ["send", "--to", me, `long ${i} ${"z".repeat(1_000)}`]);
  const first = await ok(agent, ["hook", "prompt"], S, INPUT);
  expect(first).toContain("long 0 ");
  expect(first).not.toContain("long 9 ");
  expect(first).toMatch(/… \d+ more unread/);
  const second = await ok(agent, ["hook", "prompt"], S, INPUT);
  expect(second).toContain("long 9 ");
  expect(second).not.toContain("long 0 ");
});

const session = (id: string) => ({ env: { ...S, CLAUDE_CODE_SESSION_ID: id }, input: JSON.stringify({ session_id: id, cwd: agent }) });

async function handedAcross(from: ReturnType<typeof session>, body: string): Promise<void> {
  const listener = spawn(agent, ["hook", "listen"], from.env, from.input);
  await until(listening, "the listener's slot");
  await ok(owner, ["send", "--to", me, body]);
  expect(await listener.exited).toBe(2);
  expect(await new Response(listener.stderr).text()).toContain(body);
}

test("after a /clear, the new session's first hooks don't hand over again what the earlier session's listener handed it", async () => {
  await handedAcross(session("once"), "across the clear");
  const cleared = session("once-cleared");
  expect(await ok(agent, ["hook", "stop"], cleared.env, cleared.input)).not.toContain("across the clear");
  expect(await ok(agent, ["hook", "prompt"], cleared.env, cleared.input)).not.toContain("across the clear");
});

test("after a /clear, the new session's listener started before any hook hears only what came after", async () => {
  await handedAcross(session("once-b1"), "before the second clear");
  const cleared = session("once-b2");
  const next = spawn(agent, ["hook", "listen"], cleared.env, cleared.input);
  await until(listening, "the new session's listener slot");
  await ok(owner, ["send", "--to", me, "after the second clear"]);
  expect(await next.exited).toBe(2);
  const woke = await new Response(next.stderr).text();
  expect(woke).toContain("after the second clear");
  expect(woke).not.toContain("before the second clear");
  expect(await ok(agent, ["hook", "stop"], cleared.env, cleared.input)).not.toContain("before the second clear");
});

test("a listener that can't reach the daemon keeps trying instead of leaving the session deaf", async () => {
  const sock = daemonSock(agent);
  await stopDaemon(sock).catch(() => {});
  await until(async () => !(await daemonListening(sock).catch(() => null)), "the daemon to stop");
  mkdirSync(sock);
  const listener = spawn(agent, ["hook", "listen"], S, INPUT);
  try {
    const early = await Promise.race([listener.exited, Bun.sleep(3_000).then(() => null)]);
    expect(early).toBeNull();
  } finally {
    rmSync(sock, { recursive: true, force: true });
  }
  await until(listening, "the listener's slot once the daemon can start", 30_000);
  await ok(owner, ["send", "--to", me, "heard after all"]);
  expect(await listener.exited).toBe(2);
  expect(await new Response(listener.stderr).text()).toContain("heard after all");
  await ok(agent, ["hook", "prompt"], S, INPUT);
});
