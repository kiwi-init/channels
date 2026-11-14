import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { daemonListening, daemonPeek, daemonSock } from "../src/daemon.ts";
import { hooksFixture } from "./hooks-fixture.ts";
import { sum, trafficProxy, type Traffic } from "./traffic.ts";

setDefaultTimeout(120_000);

const BUDGET = {
  quiet: { http: 0, sockets: 0 },
  oneNew: { http: 2, sockets: 0 },
} as const;

const fixture = hooksFixture({ prefix: "kiwi-budget-hooks", sessionId: "budget", channel: "hooks", transport: { kind: "proxy", start: trafficProxy } });
const { agent, owner, ok, until, hook } = fixture;
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

const measure = async (label: string, run: () => Promise<unknown>): Promise<Traffic> => {
  await Bun.sleep(300);
  fixture.proxy.reset();
  await run();
  await Bun.sleep(200);
  const t = fixture.proxy.reset();
  console.log(`${label}: ${t.http} http ${JSON.stringify(t.routes)}, ${t.sockets} sockets, ${sum(t.framesUp)} frames up ${JSON.stringify(t.framesUp)}, ${sum(t.framesDown)} frames down`);
  return t;
};

describe("relay traffic for one agent turn's hooks (prompt + stop), the agent's daemon holding its seat", () => {
  test("nothing new arrived", async () => {
    await hook("prompt");
    await hook("stop");
    let said = "";
    const t = await measure("prompt+stop, nothing new", async () => {
      said = (await hook("prompt")) + (await hook("stop"));
    });
    expect(said).toBe("");
    expect(t.http).toBeLessThanOrEqual(BUDGET.quiet.http);
    expect(t.sockets).toBeLessThanOrEqual(BUDGET.quiet.sockets);
  });

  test("one new message arrived: the prompt hook hands it over", async () => {
    await ok(owner, ["send", "--to", me, "one new for the hooks"]);
    let prompt = "";
    let stop = "";
    const t = await measure("prompt+stop, one new", async () => {
      prompt = await hook("prompt");
      stop = await hook("stop");
    });
    expect(prompt).toContain("one new for the hooks");
    expect(stop).toBe("");
    expect(t.http).toBeLessThanOrEqual(BUDGET.oneNew.http);
    expect(t.sockets).toBeLessThanOrEqual(BUDGET.oneNew.sockets);
  });

  test("a message that lands right before the stop hook is never skipped", async () => {
    await hook("prompt");
    await ok(owner, ["send", "--to", me, "just in time"]);
    expect(await hook("stop")).toContain("just in time");
  });

  test("a roster change drops the daemon's copy of the roster and settings until it has fetched them again", async () => {
    const cfg = JSON.parse(readFileSync(join(agent, "config.json"), "utf8")) as { channels: Record<string, { roomId: string }> };
    const [alias, c] = Object.entries(cfg.channels)[0]!;
    const peek = () => daemonPeek(alias, me, c.roomId, daemonSock(agent));
    await until(async () => !!(await peek())?.members, "the daemon's copy of the roster");
    await ok(owner, ["role", me, "tester"], { CLAUDECODE: "" });
    const after = await peek();
    expect(after?.members).toBeNull();
    expect(after?.info).toBeNull();
    await until(async () => !!(await peek())?.members, "the daemon fetching the roster again");
    expect(await hook("session-start")).toContain("tester");
  });
});
