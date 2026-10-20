import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListeners, daemonListening, daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(90_000);

type Env = Record<string, string>;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-once-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const claudeDir = scratch("claude");
const owner = scratch("owner");
const agent = scratch("agent");
let server: ReturnType<typeof startRelay> | undefined;
let me = "";

const S: Env = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "once", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" };
const INPUT = JSON.stringify({ session_id: "once", cwd: agent });

function spawn(home: string, args: string[], env: Env = {}, stdin?: string) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: server!.url.origin, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: "", KIWI_MODEL: "test-model", ...env },
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

async function until(pred: () => Promise<boolean>, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

const listening = () =>
  daemonListeners(daemonSock(agent))
    .then((ls) => ls.some((l) => l.kind === "hook" && l.agent === me))
    .catch(() => false);

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const code = /join code: (\S+)/.exec(await ok(owner, ["create", "once", "--as", "boss"]))![1]!;
  let out = "";
  const joining = spawn(agent, ["join", code, "--timeout", "60s"], S);
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
  await until(async () => (await daemonListening(daemonSock(agent)).catch(() => [])).some((s) => s.agent === me), "the daemon holding the seat");
});

afterAll(async () => {
  await stopDaemon(daemonSock(agent)).catch(() => {});
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

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

test("after a /clear, the earlier session's listener hands a message to the new session once, and its hooks don't hand it over again", async () => {
  const listener = spawn(agent, ["hook", "listen"], S, INPUT);
  await until(listening, "the listener's slot");
  await ok(owner, ["send", "--to", me, "across the clear"]);
  expect(await listener.exited).toBe(2);
  expect(await new Response(listener.stderr).text()).toContain("across the clear");
  const cleared = { ...S, CLAUDE_CODE_SESSION_ID: "once-cleared" };
  const input = JSON.stringify({ session_id: "once-cleared", cwd: agent });
  const next = spawn(agent, ["hook", "listen"], cleared, input);
  await until(listening, "the new session's listener slot");
  await ok(owner, ["send", "--to", me, "after the clear"]);
  expect(await next.exited).toBe(2);
  const woke = await new Response(next.stderr).text();
  expect(woke).toContain("after the clear");
  expect(woke).not.toContain("across the clear");
  expect(await ok(agent, ["hook", "stop"], cleared, input)).not.toContain("across the clear");
  expect(await ok(agent, ["hook", "prompt"], cleared, input)).not.toContain("across the clear");
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
