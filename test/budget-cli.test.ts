import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { sum, trafficProxy, type Traffic } from "./traffic.ts";

setDefaultTimeout(120_000);

const BUDGET = {
  send: { http: 1, sockets: 0 },
  listenNow: { http: 1, sockets: 0 },
  status: { http: 2, sockets: 1 },
} as const;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-budget-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: proxy!.url, KIWI_NO_HOOKS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
  return out;
}

async function until(pred: () => Promise<boolean>, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

const owner = scratch("owner");
const agent = scratch("agent");

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  const code = /join code: (\S+)/.exec(await ok(owner, "create", "budget", "--as", "lead", "--open"))![1]!;
  const joining = spawn(agent, ["join", code, "--as", "dev"]);
  let listed = "";
  await until(async () => {
    listed = await ok(owner, "--as", "human", "requests");
    return /\d{3}-\d{3}/.test(listed);
  }, "request");
  await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
  expect(await joining.exited).toBe(0);
  for (let i = 0; i < 5; i++) await ok(owner, "--as", "lead", "send", `warm-up ${i}`);
  await ok(agent, "listen", "--now");
});

afterAll(() => {
  proxy?.stop();
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const measure = async (label: string, run: () => Promise<unknown>): Promise<Traffic> => {
  await Bun.sleep(100);
  proxy!.reset();
  await run();
  await Bun.sleep(200);
  const t = proxy!.reset();
  console.log(`${label}: ${t.http} http ${JSON.stringify(t.routes)}, ${t.sockets} sockets, ${sum(t.framesDown)} frames down, ${t.bytesUp} B up, ${t.bytesDown} B down`);
  return t;
};

describe("relay traffic per agent command (each one a fresh process, as a hook is)", () => {
  test("kiwi send", async () => {
    const t = await measure("send", () => ok(agent, "send", "hello from the budget"));
    expect(t.http).toBeLessThanOrEqual(BUDGET.send.http);
    expect(t.sockets).toBeLessThanOrEqual(BUDGET.send.sockets);
  });

  test("kiwi listen --now with one new message", async () => {
    await ok(owner, "--as", "lead", "send", "one new");
    const t = await measure("listen --now", () => ok(agent, "listen", "--now"));
    expect(t.http).toBeLessThanOrEqual(BUDGET.listenNow.http);
    expect(t.sockets).toBeLessThanOrEqual(BUDGET.listenNow.sockets);
  });

  test("kiwi status", async () => {
    const t = await measure("status", () => ok(agent, "status"));
    expect(t.http).toBeLessThanOrEqual(BUDGET.status.http);
    expect(t.sockets).toBeLessThanOrEqual(BUDGET.status.sockets);
  });
});
