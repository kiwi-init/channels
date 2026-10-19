import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListening, daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { trafficProxy } from "./traffic.ts";

setDefaultTimeout(120_000);

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-offline-read-${tag}-`));
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

test("with the relay down, kiwi log and kiwi tasks show what this computer already had and say so", async () => {
  await ok(owner, ["send", "--to", me, "said before the outage"]);
  await ok(owner, ["task", "add", "a task from before the outage"]);
  expect(await ok(agent, ["log"], SESSION)).toContain("said before the outage");
  expect(await ok(agent, ["tasks"], SESSION)).toContain("a task from before the outage");
  proxy!.stop();
  for (const [args, want] of [
    [["log"], "said before the outage"],
    [["tasks"], "a task from before the outage"],
  ] as const) {
    const p = spawn(agent, [...args], SESSION);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    expect(await p.exited).toBe(0);
    expect(out).toContain(want);
    expect(err).toContain("can't reach the relay");
  }
});
