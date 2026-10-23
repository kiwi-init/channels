import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { pidAlive } from "../src/seats.ts";
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
const mimoDir = scratch("mimo");
const kimiDir = scratch("kimi");
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
  MIMOCODE_HOME: mimoDir,
  KIMI_CODE_HOME: kimiDir,
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
  | { kind: "term"; pid: number }
  | { kind: "ignored-term"; pid: number }
  | { kind: "typed"; pid: number; prompt: string; stray: number };
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

const FAKE_MIMO = `#!${process.execPath}
import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
const record = ${JSON.stringify(record)};
const session = "ses_" + crypto.randomUUID().replaceAll("-", "");
const dataDir = join(process.env.MIMOCODE_HOME, "data");
mkdirSync(dataDir, { recursive: true });
const db = new Database(join(dataDir, "mimocode.db"));
db.exec(${JSON.stringify("CREATE TABLE IF NOT EXISTS session (id text PRIMARY KEY, parent_id text, directory text NOT NULL, time_created integer NOT NULL); CREATE TABLE IF NOT EXISTS message (id text PRIMARY KEY, session_id text NOT NULL, agent_id text NOT NULL DEFAULT 'main', time_created integer NOT NULL, data text NOT NULL); CREATE TABLE IF NOT EXISTS part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, data text NOT NULL);")});
const say = (o) => appendFileSync(record, JSON.stringify(o) + "\\n");
process.on("SIGTERM", () => say({ kind: "ignored-term", pid: process.pid }));
process.on("SIGINT", () => { say({ kind: "term", pid: process.pid }); process.exit(130); });
const argv = process.argv.slice(2);
const now = Date.now();
db.prepare("INSERT INTO session (id, parent_id, directory, time_created) VALUES (?1, NULL, ?2, ?3)").run(session, realpathSync(process.cwd()), now);
db.prepare("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?1, 'm0', ?2, ?3, ?4)").run("p0", session, now, JSON.stringify({ type: "text", text: argv.at(-1) }));
db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES ('m0', ?1, ?2, ?3)").run(session, now, JSON.stringify({ role: "user", time: { created: now } }));
say({ kind: "start", harness: "mimo", pid: process.pid, argv, token: !!process.env.KIWI_SEAT_TOKEN, as: process.env.KIWI_AS, channel: process.env.KIWI_CHANNEL, marker: !!process.env.MIMOCODE_SESSION_ID, thread: session });
await Bun.sleep(1_500);
const task = /This session is for (T\\d+)/.exec(argv.at(-1) ?? "")?.[1];
if (task) {
  const p = Bun.spawn(${JSON.stringify(kiwiCmd([]))}.concat(["task", "done", task]), { env: { ...process.env, MIMOCODE: "1", MIMOCODE_PID: String(process.pid), MIMOCODE_SESSION_ID: session }, stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  await p.exited;
  say({ kind: "done", pid: process.pid, out });
}
const end = Date.now();
db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES ('m1', ?1, ?2, ?3)").run(session, end, JSON.stringify({ role: "assistant", time: { created: end, completed: end } }));
setInterval(() => {}, 1_000);
`;

const FAKE_KIMI = `#!${process.execPath}
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const record = ${JSON.stringify(record)};
const say = (o) => appendFileSync(record, JSON.stringify(o) + "\\n");
process.on("SIGTERM", () => { say({ kind: "term", pid: process.pid }); process.exit(143); });
const argv = process.argv.slice(2);
say({ kind: "start", harness: "kimi", pid: process.pid, argv, token: !!process.env.KIWI_SEAT_TOKEN, as: process.env.KIWI_AS, channel: process.env.KIWI_CHANNEL, marker: !!process.env.CLAUDE_CODE_SESSION_ID });
process.stdout.write("\\x1b[?2004hModel: fake\\r\\nNo session yet — one will be created on your first message.\\r\\n> ");
process.stdin.setRawMode(true);
process.stdin.resume();
let got = "";
const prompt = await new Promise((resolve) => {
  process.stdin.on("data", (d) => {
    got += d.toString();
    const open = got.indexOf("\\x1b[200~");
    const close = got.indexOf("\\x1b[201~");
    if (open >= 0 && close > open && /[\\r\\n]/.test(got.slice(close + 6))) resolve(got.slice(open + 6, close));
  });
});
const session = "session_" + crypto.randomUUID();
const dir = join(process.env.KIMI_CODE_HOME, "sessions", "wd_fake_1", session);
mkdirSync(join(dir, "agents", "main"), { recursive: true });
writeFileSync(join(dir, "state.json"), JSON.stringify({ id: session, cwd: realpathSync(process.cwd()), createdAt: Date.now() }));
const wire = (o) => appendFileSync(join(dir, "agents", "main", "wire.jsonl"), JSON.stringify(o) + "\\n");
wire({ type: "turn.prompt", text: prompt });
const stray = Bun.spawn(["bash", "-c", "exec -a 'kiwi listen --once' sleep 120"], { stdout: "ignore", stderr: "ignore" });
say({ kind: "typed", pid: process.pid, prompt, stray: stray.pid });
await Bun.sleep(1_500);
const task = /This session is for (T\\d+)/.exec(prompt)?.[1];
if (task) {
  wire({ type: "tool.call" });
  const p = Bun.spawn(${JSON.stringify(kiwiCmd([]))}.concat(["task", "done", task]), { env: process.env, stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  await p.exited;
  say({ kind: "done", pid: process.pid, out });
}
wire({ type: "turn.ended" });
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
  writeFileSync(join(bin, "mimo"), FAKE_MIMO);
  chmodSync(join(bin, "mimo"), 0o755);
  writeFileSync(join(bin, "kimi"), FAKE_KIMI);
  chmodSync(join(bin, "kimi"), 0o755);
  mkdirSync(join(mimoDir, "state"), { recursive: true });
  writeFileSync(join(mimoDir, "state", "model.json"), JSON.stringify({ recent: [{ providerID: "xiaomi", modelID: "mimo-test" }] }));
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

test("with --harness mimo, the loop passes MiMoCode's chosen model, finds the session by its nonce, binds the seat to it, and ends it with SIGINT once the task is done", async () => {
  const refused = spawn(agent, ["loop", "--harness", "mimo", "--effort", "high"], { PATH: `${bin}:${process.env.PATH}`, SHELL: "/bin/sh" });
  const [refusal, code] = await Promise.all([new Response(refused.stderr).text(), refused.exited]);
  expect(code).not.toBe(0);
  expect(refusal).toContain("MiMoCode keeps its effort per model in its own settings");

  const before = seen().length;
  const id = /added (T\d+)/.exec(await ok(owner, ["--as", "human", "task", "add", "mimo work", "--owner", me, "--ask", want], { CLAUDECODE: "" }))![1]!;
  const loopEnv: Env = { PATH: `${bin}:${process.env.PATH}`, SHELL: "/bin/sh", CLAUDECODE: "", CLAUDE_PID: "", MIMOCODE: "1", MIMOCODE_SESSION_ID: "outer" };
  const loop = spawn(agent, ["loop", "--harness", "mimo"], loopEnv);
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
    "the MiMoCode session's start",
  ).catch(fail);
  const start = seen()
    .slice(before)
    .find((s) => s.kind === "start");
  if (start?.kind !== "start") throw new Error("no start");
  expect(start.harness).toBe("mimo");
  expect(start.token).toBe(false);
  expect(start.marker).toBe(false);
  expect(start.argv.slice(0, 3)).toEqual(["-m", "xiaomi/mimo-test", "--prompt"]);
  expect(start.argv.at(-1)).toContain(`This session is for ${id} “mimo work”`);
  await until(() => seatOf(agent)?.session === start.thread, "the seat bound to the new session").catch(fail);
  expect(seatOf(agent)?.harness).toBe("mimo");

  await until(() => seen().some((s) => s.kind === "term" && s.pid === start.pid), "the MiMoCode session's end").catch(fail);
  expect(seen().some((s) => s.kind === "ignored-term" && s.pid === start.pid)).toBe(false);
  const done = seen().find((s) => s.kind === "done" && s.pid === start.pid);
  expect(done?.kind === "done" && done.out).toContain(id);
  expect(await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" })).toContain("state: done");

  loop.kill("SIGTERM");
  await loop.exited;
  await reading;
  await until(() => !seatOf(agent)?.hold, "the seat released");
  expect(log).toContain(`bound to MiMoCode session ${start.thread}`);
  expect(log).toContain(`${id} is over; its session ended`);
});

const shWord = (w: string) => `'${w.replace(/'/g, "'\\''")}'`;

test.skipIf(!Bun.which("tmux"))("with --harness kimi in tmux, the loop types the first prompt once Kimi is ready, binds the seat to its process, and stops the listener it left", async () => {
  const before = seen().length;
  const id = /added (T\d+)/.exec(await ok(owner, ["--as", "human", "task", "add", "kimi work", "--owner", me, "--ask", want], { CLAUDECODE: "" }))![1]!;
  const outside = spawn(agent, ["loop", "--harness", "kimi"], { PATH: `${bin}:${process.env.PATH}`, SHELL: "/bin/sh", TMUX: "", TMUX_PANE: "" });
  const [refusal, code] = await Promise.all([new Response(outside.stderr).text(), outside.exited]);
  expect(code).not.toBe(0);
  expect(refusal).toContain("runs only inside tmux");

  const where = scratch("tmux");
  const sock = join(where, "s");
  const logFile = join(where, "loop.log");
  const env: Env = { ...base(agent), PATH: `${bin}:${process.env.PATH}`, SHELL: "/bin/sh", CLAUDECODE: "", CLAUDE_PID: "", CLAUDE_CODE_SESSION_ID: "" };
  const line = ["exec", "env", ...Object.entries(env).map(([k, v]) => shWord(`${k}=${v}`)), ...kiwiCmd(["loop", "--harness", "kimi"]).map(shWord), `2>>${shWord(logFile)}`].join(" ");
  const tmux = (...args: string[]) => Bun.spawnSync(["tmux", "-S", sock, ...args], { stdout: "pipe", stderr: "pipe" });
  expect(tmux("new-session", "-d", "-s", "loop", "-x", "200", "-y", "50", "-c", agent, line).exitCode).toBe(0);
  const log = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
  const fail = (e: unknown) => {
    tmux("kill-server");
    throw new Error(`${String(e)}\n${JSON.stringify(seen().slice(before))}\n${log()}`);
  };
  try {
    await until(
      () =>
        seen()
          .slice(before)
          .some((s) => s.kind === "typed"),
      "the typed first prompt",
    ).catch(fail);
    const start = seen()
      .slice(before)
      .find((s) => s.kind === "start");
    const typed = seen()
      .slice(before)
      .find((s) => s.kind === "typed");
    if (start?.kind !== "start" || typed?.kind !== "typed") throw new Error("no start");
    expect(start.harness).toBe("kimi");
    expect(start.token).toBe(false);
    expect(start.argv).toEqual([]);
    expect(typed.prompt).toContain(`This session is for ${id} “kimi work”`);
    expect(typed.prompt).toMatch(/\r|\n/);
    expect(typed.prompt).toMatch(/\(Kiwi loop launch [0-9a-f]{18}\)$/);
    await until(() => seatOf(agent)?.pid === start.pid, "the seat bound to Kimi's process").catch(fail);
    expect(seatOf(agent)?.harness).toBe("kimi");

    await until(() => seen().some((s) => s.kind === "term" && s.pid === start.pid), "the Kimi session's end").catch(fail);
    const done = seen().find((s) => s.kind === "done" && s.pid === start.pid);
    expect(done?.kind === "done" && done.out).toContain(id);
    expect(await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" })).toContain("state: done");
    await until(() => !pidAlive(typed.stray), "the stray listener stopped").catch(fail);

    const loopPid = Number(new TextDecoder().decode(tmux("display-message", "-p", "-t", "loop", "#{pane_pid}").stdout).trim());
    process.kill(loopPid, "SIGTERM");
    await until(() => !seatOf(agent)?.hold, "the seat released").catch(fail);
    expect(log()).toContain("stopped 1 kiwi listener the session left running");
    expect(log()).toContain(`${id} is over; its session ended`);
  } finally {
    tmux("kill-server");
  }
});
