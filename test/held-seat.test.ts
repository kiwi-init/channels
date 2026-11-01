import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type SeatRecord } from "../src/config.ts";
import { daemonListening, daemonSock, stopDaemon } from "../src/daemon.ts";
import { handedText, heldText } from "../src/hold.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(120_000);

type Env = Record<string, string>;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-held-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const claudeDir = scratch("claude");
const owner = scratch("owner");
const agent = scratch("agent");
const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
let me = "";
let alias = "";
let token = "";
let key = "";
const stand = Bun.spawn(["sleep", "600"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
const third = Bun.spawn(["sleep", "600"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });

const PLAIN: Env = Object.fromEntries(
  [
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_PID",
    "CODEX_THREAD_ID",
    "GEMINI_CLI",
    "CURSOR_AGENT",
    "GROK_SESSION_ID",
    "OPENCODE_SESSION_ID",
    "MIMOCODE",
    "MIMOCODE_PID",
    "MIMOCODE_SESSION_ID",
    "PI_CODING_AGENT",
    "KIWI_PI_PID",
    "KIWI_PI_SESSION",
    "KIWI_LAUNCH",
    "KIWI_AS",
    "KIWI_CHANNEL",
    "KIWI_SEAT_TOKEN",
  ].map((k) => [k, ""]),
);
const claude = (session: string, pid: number): Env => ({ ...PLAIN, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(pid), AI_AGENT: "claude-code_2-1-296_agent" });
const OLD = claude("old-session", process.pid);
const NEW = claude("new-session", stand.pid);
const THIRD = claude("third-session", third.pid);

function spawn(home: string, args: string[], env: Env = {}, stdin?: string) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: Object.fromEntries(
      Object.entries({ ...process.env, KIWI_HOME: home, KIWI_RELAY: server.url.origin, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: agent, KIWI_MODEL: "test-model", ...env }).filter(
        ([, v]) => v !== "",
      ),
    ),
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(home: string, args: string[], env: Env = {}, stdin?: string): Promise<{ code: number; out: string; err: string }> {
  const p = spawn(home, args, env, stdin);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(home: string, args: string[], env: Env = {}, stdin?: string): Promise<string> {
  const r = await run(home, args, env, stdin);
  if (r.code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r.out;
}

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

function group(re: RegExp, text: string): string {
  const found = re.exec(text)?.[1];
  if (!found) throw new Error(`no ${re} in ${text}`);
  return found;
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value ? Reflect.get(value, name) : undefined;
}

function mcpText(reply: unknown): string {
  const content = field(field(reply, "result"), "content");
  const text = Array.isArray(content) ? field(content[0], "text") : undefined;
  if (typeof text !== "string") throw new Error(`no tool text in ${JSON.stringify(reply)}`);
  return text;
}

function mcp(env: Env) {
  const p = Bun.spawn(kiwiCmd(["mcp"]), {
    cwd: agent,
    env: Object.fromEntries(Object.entries({ ...process.env, KIWI_HOME: agent, KIWI_RELAY: server.url.origin, KIWI_NO_HOOKS: "1", ...env }).filter(([, v]) => v !== "")),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = p.stdout.getReader();
  let buf = "";
  let id = 0;
  const rpc = async (method: string, params: object = {}): Promise<unknown> => {
    const mine = ++id;
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: mine, method, params }) + "\n");
    p.stdin.flush();
    for (;;) {
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        const msg: unknown = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (field(msg, "id") === mine) return msg;
        continue;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("mcp exited");
      buf += new TextDecoder().decode(value);
    }
  };
  const call = async (name: string, args: object = {}) => mcpText(await rpc("tools/call", { name, arguments: args }));
  const start = async () => {
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
    p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    p.stdin.flush();
  };
  return { call, start, stop: () => p.kill() };
}

const prompt = (env: Env) => ok(agent, ["hook", "prompt"], env, JSON.stringify({ session_id: env.CLAUDE_CODE_SESSION_ID, cwd: agent, hook_event_name: "UserPromptSubmit", prompt: "go on" }));
const sessionStart = (env: Env) =>
  ok(agent, ["hook", "session-start"], env, JSON.stringify({ session_id: env.CLAUDE_CODE_SESSION_ID, cwd: agent, source: "startup", hook_event_name: "SessionStart" }));
const send = (text: string) => ok(owner, ["send", "--to", me, text]);

function seats(): SeatRecord[] {
  const prev = process.env.KIWI_HOME;
  process.env.KIWI_HOME = agent;
  try {
    return Object.values(loadConfig().bindings ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v]));
  } finally {
    if (prev === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = prev;
  }
}

function onlySeat(): SeatRecord {
  const [seat, ...more] = seats();
  if (!seat || more.length) throw new Error(`expected one seat, got ${JSON.stringify(seats())}`);
  return seat;
}

beforeAll(async () => {
  const code = group(/join code: (\S+)/, await ok(owner, ["create", "held", "--as", "boss"], PLAIN));
  let out = "";
  const joining = spawn(agent, ["join", code, "--timeout", "60s"], OLD);
  const reading = new Response(joining.stdout).text().then((t) => void (out = t));
  let listed = "";
  await until(async () => {
    listed = await ok(owner, ["--as", "human", "requests"], PLAIN);
    return /\d{3}-\d{3}/.test(listed);
  }, "join request");
  await ok(owner, ["--as", "human", "approve", group(/(\d{3}-\d{3})/, listed), "--yes"], PLAIN);
  expect(await joining.exited).toBe(0);
  await reading;
  me = group(/You're "([^"]+)"/, out);
  alias = onlySeat().alias;
  await until(async () => (await daemonListening(daemonSock(agent)).catch(() => [])).some((s) => s.agent === me), "the daemon holding the seat");
});

afterAll(async () => {
  stand.kill();
  third.kill();
  await stopDaemon(daemonSock(agent)).catch(() => {});
  server.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

test("while a loop holds the seat, no hook, kiwi command, MCP tool or running listener reads for it, and what arrives stays unread", async () => {
  await send("before the hold");
  expect(await prompt(OLD)).toContain("before the hold");
  const listener = spawn(agent, ["listen"], OLD);
  let heard = "";
  const hearing = (async () => {
    for await (const chunk of listener.stdout) heard += new TextDecoder().decode(chunk);
  })();
  const listenerErr = new Response(listener.stderr).text();
  const tools = mcp({ ...OLD, KIWI_CHANNEL: alias, KIWI_AS: me });
  await tools.start();
  expect(await tools.call("wait_for_messages", { timeout_seconds: 1 })).toStartWith("no messages yet");
  await send("heard live");
  await until(() => heard.includes("heard live"), "the running listener hearing a message");

  token = (await ok(agent, ["seat", "hold"], { ...PLAIN, KIWI_AS: me })).trim();
  expect(token).toMatch(/^[\w-]{40,}$/);
  const held = onlySeat();
  expect(held).toMatchObject({ alias, as: me, hold: { key: expect.any(String) } });
  expect(held).not.toHaveProperty("session");
  expect(held).not.toHaveProperty("pid");
  expect(JSON.stringify(seats())).not.toContain(token);
  key = held.hold?.key ?? "";

  await send("while held");
  await until(() => listener.exitCode !== null, "the running listener exiting");
  expect(listener.exitCode).not.toBe(0);
  await hearing;
  expect(await listenerErr).toContain(heldText(alias, me));
  expect(heard).not.toContain("while held");

  for (const [name, args] of [
    ["wait_for_messages", { timeout_seconds: 1 }],
    ["read", {}],
    ["log", {}],
    ["query", { sql: "select body from messages" }],
  ] satisfies [string, object][]) {
    const said = await tools.call(name, args);
    expect(said).toContain(heldText(alias, me));
    expect(said).not.toContain("heard live");
    expect(said).not.toContain("while held");
  }
  tools.stop();

  expect(await prompt(OLD)).not.toContain("while held");
  expect(await sessionStart(NEW)).not.toContain("while held");
  expect(await prompt(NEW)).not.toContain("while held");
  expect(onlySeat()).toMatchObject({ hold: { key } });
  expect(onlySeat()).not.toHaveProperty("session");

  for (const [args, env] of [
    [["listen", "--now"], OLD],
    [["--as", me, "listen", "--now"], OLD],
    [["--as", me, "listen", "--now"], PLAIN],
    [["listen", "--now"], { ...PLAIN, KIWI_AS: me }],
    [["listen", "--now"], { ...NEW, KIWI_AS: me }],
    [["-c", alias, "--as", me, "status"], OLD],
    [["use", alias, "--as", me], OLD],
    [["listen", "--now"], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: "not-the-token" }],
  ] satisfies [string[], Env][]) {
    const r = await run(agent, args, env);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain(heldText(alias, me));
    expect(r.out).not.toContain("while held");
  }
  expect((await run(agent, ["--as", me, "status"], { ...PLAIN, KIWI_SEAT_TOKEN: token })).code).toBe(0);

  expect((await run(agent, ["seat", "hold"], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: "another" })).err).toContain("held with another KIWI_SEAT_TOKEN");
  expect((await run(agent, ["seat", "bind", "--harness", "claude", "--session", "x"], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: "another" })).err).toContain("held with another KIWI_SEAT_TOKEN");
  expect((await run(agent, ["seat", "bind", "--harness", "grok-bot", "--session", "x"], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: token })).err).toContain("a Grok Bot has no session to bind");
  expect((await run(agent, ["seat", "bind", "--harness", "kimi", "--session", "x"], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: token })).err).toContain("pass --pid PID");
  expect((await run(agent, ["seat", "release"], { ...PLAIN, KIWI_AS: me })).code).not.toBe(0);
  expect(onlySeat()).toMatchObject({ hold: { key } });
});

test("the loop hands the seat to the session it names, which gets what arrived during the hold; the old session gets nothing", async () => {
  const bound = await ok(agent, ["seat", "bind", "--harness", "claude", "--session", "new-session", "--pid", String(stand.pid)], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: token });
  expect(bound).toContain(`bound to claude session new-session`);
  const seat = onlySeat();
  expect(seat).toMatchObject({ alias, as: me, harness: "claude", session: "new-session", pid: stand.pid });
  expect(seat).not.toHaveProperty("hold");
  expect(await prompt(OLD)).not.toContain("while held");
  const told = await prompt(NEW);
  expect(told).toContain("while held");
  expect(told).not.toContain("before the hold");
  expect(onlySeat()).toMatchObject({ session: "new-session" });
  expect((await run(agent, ["seat", "bind", "--harness", "claude", "--session", "other"], { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: token })).err).toContain("isn't held");
});

test("a listener of the bound session that heard nothing during the next hold reads nothing after the seat goes to a third session", async () => {
  const listener = spawn(agent, ["listen"], NEW);
  let heard = "";
  const hearing = (async () => {
    for await (const chunk of listener.stdout) heard += new TextDecoder().decode(chunk);
  })();
  const listenerErr = new Response(listener.stderr).text();
  await send("before the second hold");
  await until(() => heard.includes("before the second hold"), "the bound session's listener hearing a message");

  const loop = { ...PLAIN, KIWI_AS: me, KIWI_SEAT_TOKEN: token };
  await ok(agent, ["seat", "hold"], loop);
  expect(onlySeat()).toMatchObject({ holds: 2, hold: { key } });
  await ok(agent, ["seat", "bind", "--harness", "claude", "--session", "third-session", "--pid", String(third.pid)], loop);
  expect(onlySeat()).toMatchObject({ session: "third-session", holds: 2 });
  expect(listener.exitCode).toBeNull();

  await send("after the second hand-over");
  await until(() => listener.exitCode !== null, "the stale listener exiting");
  expect(listener.exitCode).not.toBe(0);
  await hearing;
  expect(await listenerErr).toContain(handedText(alias, me));
  expect(heard).not.toContain("after the second hand-over");
  expect(await prompt(THIRD)).toContain("after the second hand-over");
});
