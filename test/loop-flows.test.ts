import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(120_000);

type Env = Record<string, string>;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-loop-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const claudeDir = scratch("claude");
const codexDir = scratch("codex");
const grokDir = scratch("grok");
const bin = scratch("bin");
const owner = scratch("owner");
const agent = scratch("agent");
const record = join(scratch("record"), "fake.jsonl");
let server: ReturnType<typeof startRelay> | undefined;
let me = "";
let want = "";

const base = (home: string): Env => ({
  KIWI_HOME: home,
  KIWI_RELAY: server!.url.origin,
  CLAUDE_CONFIG_DIR: claudeDir,
  CODEX_HOME: codexDir,
  GROK_HOME: grokDir,
  KIWI_MODEL: "test-model",
  CLAUDE_PROJECT_DIR: "",
});

function spawn(home: string, args: string[], env: Env = {}) {
  return Bun.spawn(kiwiCmd(args), { cwd: home, env: { ...process.env, ...base(home), ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
}

async function ok(home: string, args: string[], env: Env = {}): Promise<string> {
  const p = spawn(home, args, env);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
  return out;
}

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 30_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(100);
  }
}

const S: Env = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "joiner", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" };

type Seen =
  | { kind: "start"; harness: string; pid: number; argv: string[]; token: boolean; as?: string; channel?: string; marker: boolean; thread?: string }
  | { kind: "done"; pid: number; out: string }
  | { kind: "term"; pid: number };
const seen = (): Seen[] =>
  existsSync(record)
    ? readFileSync(record, "utf8")
        .trim()
        .split("\n")
        .map((l): Seen => JSON.parse(l))
    : [];

const FAKE = `#!${process.execPath}
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const record = ${JSON.stringify(record)};
const sessionId = crypto.randomUUID();
const dir = join(process.env.CLAUDE_CONFIG_DIR, "sessions");
mkdirSync(dir, { recursive: true });
const reg = (status) => writeFileSync(join(dir, process.pid + ".json"), JSON.stringify({ pid: process.pid, sessionId, status, statusUpdatedAt: Date.now() - 60_000 }));
const say = (o) => appendFileSync(record, JSON.stringify(o) + "\\n");
process.on("SIGTERM", () => { say({ kind: "term", pid: process.pid }); process.exit(143); });
const argv = process.argv.slice(2);
reg("busy");
say({ kind: "start", harness: "claude", pid: process.pid, argv, token: !!process.env.KIWI_SEAT_TOKEN, as: process.env.KIWI_AS, channel: process.env.KIWI_CHANNEL, marker: !!process.env.CLAUDE_CODE_SESSION_ID });
await Bun.sleep(1_500);
const task = /This session is for (T\\d+)/.exec(argv.at(-1) ?? "")?.[1];
if (task) {
  const p = Bun.spawn(${JSON.stringify(kiwiCmd([]))}.concat(["task", "done", task]), { env: { ...process.env, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PID: String(process.pid) }, stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  await p.exited;
  say({ kind: "done", pid: process.pid, out });
}
reg("idle");
setInterval(() => {}, 1_000);
`;

const FAKE_CODEX = `#!${process.execPath}
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const record = ${JSON.stringify(record)};
const ms = Date.now().toString(16).padStart(12, "0");
const thread = ms.slice(0, 8) + "-" + ms.slice(8) + "-7" + crypto.randomUUID().slice(15);
const d = new Date();
const dir = join(process.env.CODEX_HOME, "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
mkdirSync(dir, { recursive: true });
const rollout = join(dir, "rollout-fake-" + thread + ".jsonl");
const line = (o) => appendFileSync(rollout, JSON.stringify(o) + "\\n");
const say = (o) => appendFileSync(record, JSON.stringify(o) + "\\n");
process.on("SIGTERM", () => { say({ kind: "term", pid: process.pid }); process.exit(143); });
const argv = process.argv.slice(2);
line({ type: "session_meta", payload: { id: thread, cwd: process.cwd(), originator: "codex_cli_rs" } });
line({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: argv.at(-1) }] } });
line({ type: "event_msg", payload: { type: "task_started" } });
say({ kind: "start", harness: "codex", pid: process.pid, argv, token: !!process.env.KIWI_SEAT_TOKEN, as: process.env.KIWI_AS, channel: process.env.KIWI_CHANNEL, marker: !!process.env.CODEX_THREAD_ID, thread });
await Bun.sleep(1_500);
const task = /This session is for (T\\d+)/.exec(argv.at(-1) ?? "")?.[1];
if (task) {
  const p = Bun.spawn(${JSON.stringify(kiwiCmd([]))}.concat(["task", "done", task]), { env: { ...process.env, CODEX_THREAD_ID: thread }, stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  await p.exited;
  say({ kind: "done", pid: process.pid, out });
}
line({ type: "event_msg", payload: { type: "task_complete" } });
setInterval(() => {}, 1_000);
`;

const FAKE_GROK = `#!${process.execPath}
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const record = ${JSON.stringify(record)};
const ms = Date.now().toString(16).padStart(12, "0");
const session = ms.slice(0, 8) + "-" + ms.slice(8) + "-7" + crypto.randomUUID().slice(15);
const dir = join(process.env.GROK_HOME, "sessions", encodeURIComponent(process.cwd()), session);
mkdirSync(dir, { recursive: true });
const update = (u) => appendFileSync(join(dir, "updates.jsonl"), JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId: session, update: u } }) + "\\n");
const say = (o) => appendFileSync(record, JSON.stringify(o) + "\\n");
process.on("SIGTERM", () => { say({ kind: "term", pid: process.pid }); process.exit(0); });
const argv = process.argv.slice(2);
writeFileSync(join(dir, "chat_history.jsonl"), JSON.stringify({ type: "user", content: [{ type: "text", text: argv.at(-1) }] }) + "\\n");
update({ sessionUpdate: "user_message_chunk" });
say({ kind: "start", harness: "grok", pid: process.pid, argv, token: !!process.env.KIWI_SEAT_TOKEN, as: process.env.KIWI_AS, channel: process.env.KIWI_CHANNEL, marker: !!process.env.GROK_SESSION_ID, thread: session });
await Bun.sleep(1_500);
const task = /This session is for (T\\d+)/.exec(argv.at(-1) ?? "")?.[1];
if (task) {
  update({ sessionUpdate: "tool_call" });
  const p = Bun.spawn(${JSON.stringify(kiwiCmd([]))}.concat(["task", "done", task]), { env: { ...process.env, GROK_SESSION_ID: session }, stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  await p.exited;
  say({ kind: "done", pid: process.pid, out });
}
update({ sessionUpdate: "turn_completed" });
setInterval(() => {}, 1_000);
`;

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  writeFileSync(join(bin, "claude"), FAKE);
  chmodSync(join(bin, "claude"), 0o755);
  writeFileSync(join(bin, "codex"), FAKE_CODEX);
  chmodSync(join(bin, "codex"), 0o755);
  writeFileSync(join(bin, "grok"), FAKE_GROK);
  chmodSync(join(bin, "grok"), 0o755);
  const code = /join code: (\S+)/.exec(await ok(owner, ["create", "loop", "--as", "boss"]))![1]!;
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
  want = /#(\d+)/.exec(await ok(owner, ["--as", "human", "send", "work for the loop"], { CLAUDECODE: "" }))![1]!;
});

afterAll(async () => {
  await stopDaemon(daemonSock(agent)).catch(() => {});
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const seatOf = (home: string) => {
  const prev = process.env.KIWI_HOME;
  process.env.KIWI_HOME = home;
  try {
    return Object.values(loadConfig().bindings ?? {})
      .flatMap((v) => (Array.isArray(v) ? v : [v]))
      .find((b) => b.as === me);
  } finally {
    if (prev === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = prev;
  }
};

test("the loop holds the seat, starts a fresh Claude Code session for a task, binds it, and ends it once the task is done", async () => {
  const before = seen().length;
  const loopEnv: Env = { PATH: `${bin}:${process.env.PATH}`, SHELL: "/bin/sh", CLAUDECODE: "", CLAUDE_CODE_SESSION_ID: "outer", CLAUDE_PID: "" };
  const loop = spawn(agent, ["loop", "--model", "test-model"], loopEnv);
  let log = "";
  const reading = new Response(loop.stderr).text().then((t) => void (log = t));
  const fail = async (e: unknown) => {
    loop.kill();
    await loop.exited;
    await reading;
    throw new Error(`${String(e)}\n${JSON.stringify(seen().slice(before))}\n${log}`);
  };
  await until(() => !!seatOf(agent)?.hold, "the loop's hold").catch(fail);
  expect(seen().slice(before)).toEqual([]);

  const id = /added (T\d+)/.exec(await ok(owner, ["--as", "human", "task", "add", "loop work", "--owner", me, "--ask", want], { CLAUDECODE: "" }))![1]!;
  await until(
    () =>
      seen()
        .slice(before)
        .some((s) => s.kind === "start"),
    "the session's start",
  ).catch(fail);
  const start = seen()
    .slice(before)
    .find((s) => s.kind === "start");
  if (start?.kind !== "start") throw new Error("no start");
  expect(start.token).toBe(false);
  expect(start.marker).toBe(false);
  expect(start.as).toBe(me);
  expect(start.channel).toBe("loop");
  expect(start.argv.slice(0, 2)).toEqual(["--model", "test-model"]);
  expect(start.argv.at(-1)).toContain(`This session is for ${id} “loop work”`);
  expect(start.argv.at(-1)).toContain(`kiwi task done ${id}`);
  await until(() => seatOf(agent)?.pid === start.pid, "the seat bound to the session").catch(fail);

  await until(() => seen().some((s) => s.kind === "term" && s.pid === start.pid), "the session's end").catch(fail);
  const done = seen().find((s) => s.kind === "done" && s.pid === start.pid);
  expect(done?.kind === "done" && done.out).toContain(id);
  expect(await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" })).toContain("state: done");
  expect(seatOf(agent)?.pid).not.toBe(start.pid);

  loop.kill("SIGTERM");
  await loop.exited;
  await reading;
  await until(() => !seatOf(agent)?.hold, "the seat released");
  expect(log).toContain(`${id} is over; its session ended`);
  expect(log).toContain(`released ${me} in loop`);
});

test("with --harness codex, the loop finds the new thread by the nonce in its first prompt, binds the seat to it, and ends it once the task is done", async () => {
  const before = seen().length;
  const id = /added (T\d+)/.exec(await ok(owner, ["--as", "human", "task", "add", "codex work", "--owner", me, "--ask", want], { CLAUDECODE: "" }))![1]!;
  const loopEnv: Env = { PATH: `${bin}:${process.env.PATH}`, SHELL: "/bin/sh", CLAUDECODE: "", CLAUDE_PID: "", CODEX_THREAD_ID: "outer" };
  const loop = spawn(agent, ["loop", "--harness", "codex", "--model", "gpt-test", "--effort", "high"], loopEnv);
  let log = "";
  const reading = new Response(loop.stderr).text().then((t) => void (log = t));

  await until(
    () =>
      seen()
        .slice(before)
        .some((s) => s.kind === "start"),
    "the Codex session's start",
  );
  const start = seen()
    .slice(before)
    .find((s) => s.kind === "start");
  if (start?.kind !== "start") throw new Error("no start");
  expect(start.harness).toBe("codex");
  expect(start.token).toBe(false);
  expect(start.marker).toBe(false);
  expect(start.argv.slice(0, 4)).toEqual(["-m", "gpt-test", "-c", 'model_reasoning_effort="high"']);
  expect(start.argv.at(-1)).toContain(`This session is for ${id} “codex work”`);
  expect(start.argv.at(-1)).toMatch(/\(Kiwi loop launch [0-9a-f]{18}\)$/);
  await until(() => seatOf(agent)?.session === start.thread, "the seat bound to the new thread");
  expect(seatOf(agent)?.harness).toBe("codex");

  await until(
    () =>
      seen()
        .slice(before)
        .some((s) => s.kind === "term" && s.pid === start.pid),
    "the Codex session's end",
  ).catch(async (e: unknown) => {
    loop.kill();
    await loop.exited;
    await reading;
    throw new Error(`${String(e)}\n${JSON.stringify(seen().slice(before))}\n${log}`);
  });
  const done = seen()
    .slice(before)
    .find((s) => s.kind === "done" && s.pid === start.pid);
  expect(done?.kind === "done" && done.out).toContain(id);
  expect(await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" })).toContain("state: done");

  loop.kill("SIGTERM");
  await loop.exited;
  await reading;
  await until(() => !seatOf(agent)?.hold, "the seat released");
  expect(log).toContain(`bound to Codex session ${start.thread}`);
  expect(log).toContain(`${id} is over; its session ended`);
});

test("with --harness grok, the loop asks for a listener, finds the session by its nonce in this folder, binds the seat to it, and ends it once the task is done", async () => {
  const before = seen().length;
  const id = /added (T\d+)/.exec(await ok(owner, ["--as", "human", "task", "add", "grok work", "--owner", me, "--ask", want], { CLAUDECODE: "" }))![1]!;
  const loopEnv: Env = { PATH: `${bin}:${process.env.PATH}`, SHELL: "/bin/sh", CLAUDECODE: "", CLAUDE_PID: "", GROK_SESSION_ID: "outer" };
  const loop = spawn(agent, ["loop", "--harness", "grok", "--model", "grok-test", "--effort", "high"], loopEnv);
  let log = "";
  const reading = new Response(loop.stderr).text().then((t) => void (log = t));
  const fail = async (e: unknown) => {
    loop.kill();
    await loop.exited;
    await reading;
    throw new Error(`${String(e)}\n${JSON.stringify(seen().slice(before))}\n${log}`);
  };
  await until(
    () =>
      seen()
        .slice(before)
        .some((s) => s.kind === "start"),
    "the Grok session's start",
  ).catch(fail);
  const start = seen()
    .slice(before)
    .find((s) => s.kind === "start");
  if (start?.kind !== "start") throw new Error("no start");
  expect(start.harness).toBe("grok");
  expect(start.token).toBe(false);
  expect(start.marker).toBe(false);
  expect(start.argv.slice(0, 4)).toEqual(["-m", "grok-test", "--reasoning-effort", "high"]);
  expect(start.argv.at(-1)).toContain(`This session is for ${id} “grok work”`);
  expect(start.argv.at(-1)).toContain("start the monitor tool with command `kiwi listen`");
  await until(() => seatOf(agent)?.session === start.thread, "the seat bound to the new session").catch(fail);
  expect(seatOf(agent)?.harness).toBe("grok");

  await until(
    () =>
      seen()
        .slice(before)
        .some((s) => s.kind === "term" && s.pid === start.pid),
    "the Grok session's end",
  ).catch(fail);
  const done = seen()
    .slice(before)
    .find((s) => s.kind === "done" && s.pid === start.pid);
  expect(done?.kind === "done" && done.out).toContain(id);
  expect(await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" })).toContain("state: done");

  loop.kill("SIGTERM");
  await loop.exited;
  await reading;
  await until(() => !seatOf(agent)?.hold, "the seat released");
  expect(log).toContain(`bound to Grok session ${start.thread}`);
  expect(log).toContain(`${id} is over; its session ended`);
});
