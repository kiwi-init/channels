import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListening, daemonPeek, daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { sum, trafficProxy, type Traffic } from "./traffic.ts";

setDefaultTimeout(120_000);

const BUDGET = {
  quiet: { http: 0, sockets: 0 },
  oneNew: { http: 2, sockets: 0 },
} as const;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-budget-hooks-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const claudeDir = scratch("claude");
const owner = scratch("owner");
const agent = scratch("agent");
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;
let me = "";

type Env = Record<string, string>;

const SESSION: Env = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "budget", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" };
const HOOK_INPUT = JSON.stringify({ session_id: "budget", cwd: agent });

function spawn(home: string, args: string[], env: Env = {}, stdin?: string) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: proxy!.url, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: "", KIWI_MODEL: "test-model", ...env },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function ok(home: string, args: string[], env: Env = {}, stdin?: string): Promise<string> {
  const p = spawn(home, args, env, stdin);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
  return out;
}

const hook = (event: string) => ok(agent, ["hook", event], SESSION, HOOK_INPUT);

async function until(pred: () => Promise<boolean>, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  const code = /join code: (\S+)/.exec(await ok(owner, ["create", "hooks", "--as", "boss"]))![1]!;
  let out = "";
  const joining = spawn(agent, ["join", code, "--timeout", "60s"], SESSION);
  const reading = new Response(joining.stdout).text().then((t) => void (out = t));
  let listed = "";
  await until(async () => {
    listed = await ok(owner, ["--as", "human", "requests"], { CLAUDECODE: "" });
    return /\d{3}-\d{3}/.test(listed);
  }, "join request");
  await ok(owner, ["--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"], { CLAUDECODE: "" });
  expect(await joining.exited).toBe(0);
  await reading;
  me = /You're "([^"]+)"/.exec(out)![1]!;
  await until(async () => (await daemonListening(daemonSock(agent)).catch(() => [])).some((s) => s.agent === me), "the agent's daemon holding its seat");
  for (let i = 0; i < 3; i++) await ok(owner, ["send", "--to", me, `warm-up ${i}`]);
  expect(await hook("prompt")).toContain("warm-up 2");
  await hook("stop");
});

afterAll(async () => {
  await stopDaemon(daemonSock(agent));
  proxy?.stop();
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const measure = async (label: string, run: () => Promise<unknown>): Promise<Traffic> => {
  await Bun.sleep(300);
  proxy!.reset();
  await run();
  await Bun.sleep(200);
  const t = proxy!.reset();
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
