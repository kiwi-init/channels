import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { daemonListening, daemonSock } from "../src/daemon.ts";
import { hooksFixture } from "./hooks-fixture.ts";
import { trafficProxy } from "./traffic.ts";

setDefaultTimeout(120_000);

const fixture = hooksFixture({ prefix: "kiwi-offline-read", sessionId: "budget", channel: "hooks", transport: { kind: "proxy", start: trafficProxy } });
const { agent, owner, ok, until, spawn, hook, env: SESSION } = fixture;
let me = "";

beforeAll(async () => {
  await fixture.start();
  me = fixture.me;
  await until(async () => (await daemonListening(daemonSock(agent)).catch(() => [])).some((s) => s.agent === me), "the agent's daemon holding its seat");
  for (let i = 0; i < 3; i++) await ok(owner, ["send", "--to", me, `warm-up ${i}`]);
  expect(await hook("prompt")).toContain("warm-up 2");
  await hook("stop");
});

afterAll(() => fixture.dispose());

test("with the relay down, kiwi log and kiwi task show what this computer already had and say so", async () => {
  await ok(owner, ["send", "--to", me, "said before the outage"]);
  await ok(owner, ["--as", "human", "task", "add", "a task from before the outage"]);
  expect(await ok(agent, ["log"], SESSION)).toContain("said before the outage");
  expect(await ok(agent, ["task"], SESSION)).toContain("a task from before the outage");
  fixture.proxy.stop();
  for (const [args, want] of [
    [["log"], "said before the outage"],
    [["task"], "a task from before the outage"],
  ] as const) {
    const p = spawn(agent, [...args], SESSION);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    expect(await p.exited).toBe(0);
    expect(out).toContain(want);
    expect(err).toContain("can't reach the relay");
  }
});
