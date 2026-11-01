import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { pidAlive } from "../src/pid.ts";
import { tmuxPastesFlag } from "../src/loop/kimi.ts";
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

function added(out: string): string {
  const id = /added (T\d+)/.exec(out)?.[1];
  if (!id) throw new Error(`no task id in: ${out}`);
  return id;
}

const S: Env = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "joiner", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" };

type Seen =
  | { kind: "start"; harness: string; pid: number; argv: string[]; token: boolean; as?: string; channel?: string; loop?: string; loopTask?: string; marker: boolean; thread?: string }
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
say({ kind: "start", harness: "claude", pid: process.pid, argv, token: !!process.env.KIWI_SEAT_TOKEN, as: process.env.KIWI_AS, channel: process.env.KIWI_CHANNEL, loop: process.env.KIWI_LOOP, loopTask: process.env.KIWI_LOOP_TASK, marker: !!process.env.CLAUDE_CODE_SESSION_ID });
await Bun.sleep(1_500);
const task = /This session is for (T\\d+)/.exec(argv.at(-1) ?? "")?.[1];
if (task && !(argv.at(-1) ?? "").includes("“loop hold”")) {
  const p = Bun.spawn(${JSON.stringify(kiwiCmd([]))}.concat(["task", "done", task]), { env: { ...process.env, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PID: String(process.pid) }, stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  await p.exited;
  say({ kind: "done", pid: process.pid, out });
}
const judged = /This session is for reviewing round (\\d+) of (T\\d+)/.exec(argv.at(-1) ?? "");
if (judged) {
  const p = Bun.spawn(${JSON.stringify(kiwiCmd([]))}.concat(["task", "approve", judged[2], "--round", judged[1], "looks right"]), { env: { ...process.env, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: sessionId, CLAUDE_PID: String(process.pid) }, stdout: "pipe", stderr: "pipe" });
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

const zcodeDir = scratch("zcode");
const zcodeBin = scratch("zcode-bin");

const FAKE_ZCODE = `import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
const record = ${JSON.stringify(record)};
const say = (o) => appendFileSync(record, JSON.stringify(o) + "\\n");
process.on("SIGTERM", () => { say({ kind: "term", pid: process.pid }); process.exit(143); });
say({ kind: "start", harness: "zcode", pid: process.pid, argv: process.argv.slice(2), token: !!process.env.KIWI_SEAT_TOKEN, as: process.env.KIWI_AS, channel: process.env.KIWI_CHANNEL, marker: !!process.env.ZCODE_RUNTIME_ENV });
process.stdout.write("ZCode 0.17.0\\r\\nStatus\\r\\nStarting\\r\\n");
await Bun.sleep(800);
process.stdout.write(" \\u256d\\u2500 Build \\u2500\\u256e\\r\\n \\u2502 Type a prompt \\u2502\\r\\n");
await Bun.sleep(400);
process.stdout.write("\\x1b[?2004h");
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
const dir = join(process.env.KIWI_ZCODE_DIR, "db");
mkdirSync(dir, { recursive: true });
const db = new Database(join(dir, "db.sqlite"));
db.run("create table if not exists session (id text primary key, directory text not null, parent_id text, time_created integer not null, time_updated integer not null)");
db.run("create table if not exists message (id text primary key, session_id text not null, time_created integer not null, data text not null)");
db.run("create table if not exists part (id text primary key, message_id text not null, session_id text not null, data text not null)");
db.run("create table if not exists turn_usage (session_id text not null, turn_id text not null, user_message_id text, status text not null, started_at integer not null, completed_at integer)");
const session = "sess_" + crypto.randomUUID();
const asked = Date.now();
db.run("insert into session values (?, ?, ?, ?, ?)", [session, realpathSync(process.cwd()), null, asked, asked]);
db.run("insert into message values (?, ?, ?, ?)", ["msg_p_" + session, session, asked, JSON.stringify({ role: "user" })]);
db.run("insert into part values (?, ?, ?, ?)", ["prt_p_" + session, "msg_p_" + session, session, JSON.stringify({ type: "text", text: prompt })]);
db.run("insert into message values (?, ?, ?, ?)", ["msg_s_" + session, session, asked + 5, JSON.stringify({ role: "user" })]);
const stray = Bun.spawn(["bash", "-c", "exec -a 'kiwi listen --once' sleep 120"], { stdout: "ignore", stderr: "ignore" });
say({ kind: "typed", pid: process.pid, prompt, stray: stray.pid });
await Bun.sleep(1_500);
const task = /This session is for (T\\d+)/.exec(prompt)?.[1];
if (task) {
  const p = Bun.spawn(${JSON.stringify(kiwiCmd([]))}.concat(["task", "done", task]), { env: { ...process.env, ZCODE_RUNTIME_ENV: "1" }, stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
  await p.exited;
  say({ kind: "done", pid: process.pid, out });
}
db.run("insert into turn_usage values (?, ?, ?, ?, ?, ?)", [session, "turn_1", "msg_p_" + session, "completed", asked, Date.now()]);
setInterval(() => {}, 1_000);
`;

const FAKE_KIMI = `#!${process.execPath}
import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const record = ${JSON.stringify(record)};
const say = (o) => appendFileSync(record, JSON.stringify(o) + "\\n");
process.on("SIGTERM", () => { say({ kind: "term", pid: process.pid }); process.kill(process.pid, "SIGKILL"); });
const argv = process.argv.slice(2);
say({ kind: "start", harness: "kimi", pid: process.pid, argv, token: !!process.env.KIWI_SEAT_TOKEN, as: process.env.KIWI_AS, channel: process.env.KIWI_CHANNEL, marker: !!process.env.CLAUDE_CODE_SESSION_ID });
process.stdout.write("Model: fake\\r\\nNo session yet — one will be created on your first message.\\r\\n> ");
await Bun.sleep(1_000);
process.stdout.write("\\x1b[?2004h");
Bun.spawnSync(["stty", "raw", "-echo"], { stdin: "inherit" });
process.stdin.resume();
process.stdin.on("data", (d) => { if (d.includes(3)) process.kill(process.pid, "SIGKILL"); });
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
  writeFileSync(join(zcodeBin, "fake.js"), FAKE_ZCODE);
  symlinkSync(process.execPath, join(zcodeBin, "zcode-cli"));
  writeFileSync(join(bin, "zcode-cli"), `#!/bin/sh\nexec ${JSON.stringify(join(zcodeBin, "zcode-cli"))} ${JSON.stringify(join(zcodeBin, "fake.js"))}\n`);
  chmodSync(join(bin, "zcode-cli"), 0o755);
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
  expect(start.loop).toBe("1");
  expect(start.loopTask).toBe(id.slice(1));
  expect(start.argv.slice(0, 2)).toEqual(["--model", "test-model"]);
  expect(start.argv.at(-1)).toContain(`This session is for ${id} “loop work”`);
  expect(start.argv.at(-1)).toContain(`kiwi task done ${id}`);
  await until(() => seatOf(agent)?.pid === start.pid, "the seat bound to the session").catch(fail);

  await until(() => seen().some((s) => s.kind === "term" && s.pid === start.pid), "the session's end").catch(fail);
  const done = seen().find((s) => s.kind === "done" && s.pid === start.pid);
  expect(done?.kind === "done" && done.out).toContain(id);
  expect(await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" })).toContain("status: done");
  expect(seatOf(agent)?.pid).not.toBe(start.pid);

  loop.kill("SIGTERM");
  await loop.exited;
  await reading;
  await until(() => !seatOf(agent)?.hold, "the seat released");
  expect(log).toContain(`${id} is over; its session ended`);
  expect(log).toContain(`released ${me} in loop`);
});

test("a task assigned behind a session whose work never ends is named on stderr, and dropping the stuck task starts it (#1154)", async () => {
  const before = seen().length;
  const loopEnv: Env = { PATH: `${bin}:${process.env.PATH}`, SHELL: "/bin/sh", CLAUDECODE: "", CLAUDE_CODE_SESSION_ID: "outer", CLAUDE_PID: "" };
  const loop = spawn(agent, ["loop", "--model", "test-model"], loopEnv);
  let log = "";
  const decoder = new TextDecoder();
  const reading = (async () => {
    for await (const chunk of loop.stderr) log += decoder.decode(chunk);
  })();
  const fail = async (e: unknown) => {
    loop.kill();
    await loop.exited;
    await reading;
    throw new Error(`${String(e)}\n${JSON.stringify(seen().slice(before))}\n${log}`);
  };
  const startOf = (id: string) =>
    seen()
      .slice(before)
      .find((s) => s.kind === "start" && (s.argv.at(-1) ?? "").includes(`This session is for ${id} `));
  await until(() => !!seatOf(agent)?.hold, "the loop's hold").catch(fail);
  const held = added(await ok(owner, ["--as", "human", "task", "add", "loop hold", "--owner", me, "--ask", want], { CLAUDECODE: "" }));
  await until(() => !!startOf(held), "the held task's session").catch(fail);
  const next = added(await ok(owner, ["--as", "human", "task", "add", "loop next", "--owner", me, "--ask", want], { CLAUDECODE: "" }));
  await until(() => log.includes(`${next} is waiting; the ${held} session is still running`), "the waiting notice").catch(fail);
  expect(startOf(next)).toBeUndefined();

  await ok(owner, ["--as", "human", "task", "drop", held], { CLAUDECODE: "" });
  await until(() => !!startOf(next), "the waiting task's session").catch(fail);
  const started = startOf(next);
  await until(() => seen().some((s) => s.kind === "term" && started?.kind === "start" && s.pid === started.pid), "the waiting task's session end").catch(fail);
  expect(await ok(owner, ["--as", "human", "task", "show", next], { CLAUDECODE: "" })).toContain("status: done");

  loop.kill("SIGTERM");
  await loop.exited;
  await reading;
  await until(() => !seatOf(agent)?.hold, "the seat released");
  expect(log.split(`${next} is waiting`).length).toBe(2);
});

test("a round open to anyone who hasn't worked on the task is taken by a reviewer's loop, which names itself first and then reviews it (#1244)", async () => {
  const before = seen().length;
  const id = added(await ok(owner, ["--as", "human", "task", "add", "loop review", "--owner", "boss", "--review", "any", "--ask", want], { CLAUDECODE: "" }));
  await ok(owner, ["--as", "boss", "task", "review", id, "--at", "abc1234"], { CLAUDECODE: "" });
  const loopEnv: Env = { PATH: `${bin}:${process.env.PATH}`, SHELL: "/bin/sh", CLAUDECODE: "", CLAUDE_CODE_SESSION_ID: "outer", CLAUDE_PID: "" };
  const loop = spawn(agent, ["loop", "--model", "test-model"], loopEnv);
  let log = "";
  const decoder = new TextDecoder();
  const reading = (async () => {
    for await (const chunk of loop.stderr) log += decoder.decode(chunk);
  })();
  const fail = async (e: unknown) => {
    loop.kill();
    await loop.exited;
    await reading;
    throw new Error(`${String(e)}\n${JSON.stringify(seen().slice(before))}\n${log}`);
  };
  const startOf = () =>
    seen()
      .slice(before)
      .find((s) => s.kind === "start" && (s.argv.at(-1) ?? "").includes(`reviewing round 1 of ${id}`));
  await until(() => !!startOf(), "the review session").catch(fail);
  const started = startOf();
  await until(() => seen().some((s) => s.kind === "term" && started?.kind === "start" && s.pid === started.pid), "the review session's end").catch(fail);
  const shown = await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" });
  expect(shown).toContain("status: done");
  expect(shown).toContain(`approved by ${me}`);

  loop.kill("SIGTERM");
  await loop.exited;
  await reading;
  await until(() => !seatOf(agent)?.hold, "the seat released");
  expect(log).toContain(`took ${id} round 1's review`);
  expect(log).toContain(`${id} round 1 is over; its session ended`);
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
  expect(await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" })).toContain("status: done");

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
  expect(await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" })).toContain("status: done");

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
  expect(await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" })).toContain("status: done");

  loop.kill("SIGTERM");
  await loop.exited;
  await reading;
  await until(() => !seatOf(agent)?.hold, "the seat released");
  expect(log).toContain(`bound to MiMoCode session ${start.thread}`);
  expect(log).toContain(`${id} is over; its session ended`);
});

const tmuxPastes = !!Bun.which("tmux") && tmuxPastesFlag(new TextDecoder().decode(Bun.spawnSync(["tmux", "-V"]).stdout));
const shWord = (w: string) => `'${w.replace(/'/g, "'\\''")}'`;

test.skipIf(!tmuxPastes)("with --harness kimi in tmux 3.7 or newer, the loop types the first prompt once Kimi is ready, binds the seat to its process, and stops the listener it left", async () => {
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
    expect(await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" })).toContain("status: done");
    await until(() => !pidAlive(typed.stray), "the stray listener stopped").catch(fail);

    await until(() => log().includes(`${id} is over; its session ended`), "the loop back to waiting").catch(fail);
    let pressed = 0;
    await until(
      () => {
        if (log().includes(`released ${me} in`)) return true;
        if (Date.now() - pressed > 1_000) {
          tmux("send-keys", "-t", "loop", "C-c");
          pressed = Date.now();
        }
        return false;
      },
      "the seat released by Ctrl-C",
      60_000,
    ).catch(fail);
    expect(log()).toContain("stopped 1 kiwi listener the session left running");
    expect(log()).toContain(`${id} is over; its session ended`);
  } finally {
    tmux("kill-server");
  }
});

test.skipIf(!tmuxPastes)(
  "with --harness zcode in tmux, the loop types the first prompt once ZCode's prompt box shows, finds the session in ZCode's database, binds the seat to its zcode-cli process, and ends it once the task is done (#1157)",
  async () => {
    const before = seen().length;
    const id = added(await ok(owner, ["--as", "human", "task", "add", "zcode work", "--owner", me, "--ask", want], { CLAUDECODE: "" }));
    const refused = spawn(agent, ["loop", "--harness", "zcode", "--model", "glm-5"], { PATH: `${bin}:${process.env.PATH}`, SHELL: "/bin/sh", TMUX: "", TMUX_PANE: "" });
    const [refusal, refusedCode] = await Promise.all([new Response(refused.stderr).text(), refused.exited]);
    expect(refusedCode).not.toBe(0);
    expect(refusal).toContain("runs only inside tmux");

    const where = scratch("tmux-zcode");
    const sock = join(where, "s");
    const logFile = join(where, "loop.log");
    const env: Env = { ...base(agent), KIWI_ZCODE_DIR: zcodeDir, PATH: `${bin}:${process.env.PATH}`, SHELL: "/bin/sh", CLAUDECODE: "", CLAUDE_PID: "", CLAUDE_CODE_SESSION_ID: "" };
    const command = (args: string[]) => ["exec", "env", ...Object.entries(env).map(([k, v]) => shWord(`${k}=${v}`)), ...kiwiCmd(args).map(shWord), `2>>${shWord(logFile)}`].join(" ");
    const tmux = (...args: string[]) => Bun.spawnSync(["tmux", "-S", sock, ...args], { stdout: "pipe", stderr: "pipe" });
    const log = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
    const fail = (e: unknown) => {
      tmux("kill-server");
      throw new Error(`${String(e)}\n${JSON.stringify(seen().slice(before))}\n${log()}`);
    };
    try {
      expect(tmux("new-session", "-d", "-s", "model", "-x", "200", "-y", "50", "-c", agent, command(["loop", "--harness", "zcode", "--model", "glm-5"])).exitCode).toBe(0);
      await until(() => log().includes("drop --model"), "the --model refusal").catch(fail);
      expect(tmux("new-session", "-d", "-s", "loop", "-x", "200", "-y", "50", "-c", agent, command(["loop", "--harness", "zcode"])).exitCode).toBe(0);
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
      expect(start.harness).toBe("zcode");
      expect(start.token).toBe(false);
      expect(start.marker).toBe(false);
      expect(start.argv).toEqual([]);
      expect(typed.prompt).toContain(`This session is for ${id} “zcode work”`);
      expect(typed.prompt).toContain("listen --once`, run_in_background: true, and no timeout");
      expect(typed.prompt).toMatch(/\(Kiwi loop launch [0-9a-f]{18}\)$/);
      await until(() => seatOf(agent)?.pid === start.pid, "the seat bound to ZCode's process").catch(fail);
      expect(seatOf(agent)?.harness).toBe("zcode");
      expect(seatOf(agent)?.session).toBe(`zcode-pid-${start.pid}`);

      await until(() => seen().some((s) => s.kind === "term" && s.pid === start.pid), "the ZCode session's end").catch(fail);
      const done = seen().find((s) => s.kind === "done" && s.pid === start.pid);
      expect(done?.kind === "done" && done.out).toContain(id);
      expect(await ok(owner, ["--as", "human", "task", "show", id], { CLAUDECODE: "" })).toContain("status: done");
      await until(() => !pidAlive(typed.stray), "the stray listener stopped").catch(fail);

      const loopPid = Number(new TextDecoder().decode(tmux("display-message", "-p", "-t", "loop", "#{pane_pid}").stdout).trim());
      process.kill(loopPid, "SIGTERM");
      await until(() => !seatOf(agent)?.hold, "the seat released").catch(fail);
      expect(log()).toContain(`${id} is over; its session ended`);
      expect(existsSync(join(zcodeDir, "config.json"))).toBe(true);
    } finally {
      tmux("kill-server");
    }
  },
);

test("on tmux older than 3.7, kiwi loop --harness kimi refuses up front instead of waiting for a paste flag tmux can't report", async () => {
  const shim = scratch("oldtmux");
  writeFileSync(
    join(shim, "tmux"),
    `#!/bin/sh
case "$*" in
  *"#{version}"*) echo 3.6a ;;
  *"#{pane_pid}"*) echo ${process.pid} ;;
  *) exit 0 ;;
esac
`,
  );
  chmodSync(join(shim, "tmux"), 0o755);
  const loop = spawn(agent, ["loop", "--harness", "kimi"], { PATH: `${shim}:${bin}:${process.env.PATH}`, SHELL: "/bin/sh", TMUX: `${join(shim, "sock")},1,0`, TMUX_PANE: "%1" });
  const [refusal, code] = await Promise.all([new Response(loop.stderr).text(), loop.exited]);
  expect(code).not.toBe(0);
  expect(refusal).toContain("Kimi Code's first prompt needs tmux 3.7 or newer, to know when it can paste; this tmux is 3.6a");
});
