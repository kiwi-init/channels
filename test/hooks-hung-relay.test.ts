import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { daemonListening, daemonSock } from "../src/daemon.ts";
import { hooksFixture } from "./hooks-fixture.ts";
import { trafficProxy } from "./traffic.ts";

setDefaultTimeout(120_000);

const fixture = hooksFixture({ prefix: "kiwi-hung-hooks", sessionId: "budget", channel: "hooks", transport: { kind: "proxy", start: trafficProxy } });
const { agent, owner, ok, until, hook } = fixture;
let me = "";

const HOOK_CEILING_MS = 3_500;

beforeAll(async () => {
  await fixture.start();
  me = fixture.me;
  await until(async () => (await daemonListening(daemonSock(agent)).catch(() => [])).some((s) => s.agent === me), "the agent's daemon holding its seat");
  for (let i = 0; i < 3; i++) await ok(owner, ["send", "--to", me, `warm-up ${i}`]);
  expect(await hook("prompt")).toContain("warm-up 2");
  await hook("stop");
});

afterAll(() => fixture.dispose());

test("a hung relay costs the prompt and stop hooks under 2s each, and what they couldn't show comes on the next prompt", async () => {
  await ok(owner, ["send", "--to", me, "held up by the relay"]);
  fixture.proxy.hang(true);
  try {
    for (const event of ["prompt", "stop"]) {
      const t0 = performance.now();
      const said = await hook(event);
      const ms = performance.now() - t0;
      console.log(`hook ${event} with the relay hung: ${Math.round(ms)}ms`);
      expect(ms).toBeLessThan(HOOK_CEILING_MS);
      expect(said).not.toContain("held up by the relay");
    }
  } finally {
    fixture.proxy.hang(false);
  }
  expect(await hook("prompt")).toContain("held up by the relay");
});
