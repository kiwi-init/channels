import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListeners, daemonListening, daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";
import { addDocWake, pendingDocWakes } from "../src/config/doc-wakes.ts";
import { loadConfig } from "../src/config.ts";
import { notePending, settlePending } from "../src/hooks/delivered.ts";

setDefaultTimeout(90_000);

type Env = Record<string, string>;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-dochand-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const claudeDir = scratch("claude");
const owner = scratch("owner");
const agent = scratch("agent");
let server: ReturnType<typeof startRelay> | undefined;
let me = "";

const S: Env = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "dochand", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" };
const INPUT = JSON.stringify({ session_id: "dochand", cwd: agent });

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
  const code = /join code: (\S+)/.exec(await ok(owner, ["create", "dochand", "--as", "boss"]))![1]!;
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

const inAgent = <T>(f: () => T): T => {
  const was = process.env.KIWI_HOME;
  process.env.KIWI_HOME = agent;
  try {
    return f();
  } finally {
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
  }
};

const wake = (block: string, text: string) => ({ key: "main", th: "t".repeat(22), block, author: "boss", text, context: "", selection: null, at: Date.now() });

test("a doc wake the listen hook pulled, then died holding, still reaches the next read (T669)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  inAgent(() => addDocWake(alias, me, wake("b".repeat(22), `@${me} does the doc wake survive?`)));
  mkdirSync(join(agent, "hook-state"), { recursive: true });
  writeFileSync(join(agent, "hook-state", `dochand.${process.pid}.answering`), String(process.pid));
  const listener = spawn(agent, ["hook", "listen"], S, INPUT);
  await until(listening, "the listener's slot");
  await Bun.sleep(2_500);
  listener.kill(9);
  await listener.exited;
  rmSync(join(agent, "hook-state", `dochand.${process.pid}.answering`), { force: true });
  expect(inAgent(() => pendingDocWakes(alias, me)).map((w) => w.block)).toEqual(["b".repeat(22)]);
  expect(await ok(agent, ["listen", "--now"], S)).toContain("does the doc wake survive?");
  expect(inAgent(() => pendingDocWakes(alias, me))).toEqual([]);
});

test("a doc wake the listen hook hands over is told once, and the next read doesn't show it again (T669)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  inAgent(() => addDocWake(alias, me, wake("c".repeat(22), `@${me} handed once`)));
  const listener = spawn(agent, ["hook", "listen"], S, INPUT);
  expect(await listener.exited).toBe(2);
  expect(await new Response(listener.stderr).text()).toContain("handed once");
  expect(inAgent(() => pendingDocWakes(alias, me))).toEqual([]);
});

test("an acked hand-over tells its doc wakes when the host says it landed, and not before (T669)", () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  const block = "d".repeat(22);
  inAgent(() => {
    addDocWake(alias, me, wake(block, "acked"));
    notePending(alias, me, "acked", "tok-1", 0, [block]);
    expect(settlePending(alias, me, "acked", "tok-2")).toBeNull();
    expect(pendingDocWakes(alias, me).map((w) => w.block)).toEqual([block]);
    expect(settlePending(alias, me, "acked", "tok-1")).toBe(0);
    expect(pendingDocWakes(alias, me)).toEqual([]);
  });
});

const NOHARNESS: Env = { CLAUDECODE: "", CLAUDE_CODE_SESSION_ID: "", CLAUDE_PID: "", AI_AGENT: "", CODEX_THREAD_ID: "", CURSOR_AGENT: "" };

test("kiwi wait hands over a doc-only line and tells it (T1741)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  inAgent(() => addDocWake(alias, me, wake("e".repeat(22), `@${me} only in the doc`)));
  const out = await ok(agent, ["wait", "--timeout", "5s"], NOHARNESS);
  expect(out).toContain("only in the doc");
  expect(inAgent(() => pendingDocWakes(alias, me))).toEqual([]);
});

test("kiwi wait hands over a doc-only line that lands while it waits (T1741)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  const p = spawn(agent, ["wait", "--timeout", "10s"], NOHARNESS);
  await Bun.sleep(1_500);
  inAgent(() => addDocWake(alias, me, wake("f".repeat(22), `@${me} arrived mid-wait`)));
  expect(await p.exited).toBe(0);
  expect(await new Response(p.stdout).text()).toContain("arrived mid-wait");
});

test("kiwi tail streams doc-only lines (T1741)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  inAgent(() => addDocWake(alias, me, wake("g".repeat(22), `@${me} streamed from the doc`)));
  const p = spawn(agent, ["tail"], NOHARNESS);
  let out = "";
  const reading = new Response(p.stdout).text().then((t) => void (out = t));
  await until(async () => inAgent(() => pendingDocWakes(alias, me)).length === 0, "tail telling the first line");
  inAgent(() => addDocWake(alias, me, wake("h".repeat(22), `@${me} and a second one`)));
  await until(async () => inAgent(() => pendingDocWakes(alias, me)).length === 0, "tail telling the second line");
  p.kill();
  await p.exited;
  await reading;
  expect(out).toContain("streamed from the doc");
  expect(out).toContain("and a second one");
});

test("hooks with only doc lines say where to answer, not reply N (T1741)", async () => {
  const alias = inAgent(() => Object.keys(loadConfig().channels)[0]!);
  inAgent(() => addDocWake(alias, me, wake("i".repeat(22), `@${me} a stop-hook line`)));
  const stop = JSON.parse(await ok(agent, ["hook", "stop"], S, JSON.stringify({ session_id: "dochand", cwd: agent, hook_event_name: "Stop" }))) as { reason: string };
  expect(stop.reason).toContain("a stop-hook line");
  expect(stop.reason).toContain("shared doc");
  expect(stop.reason).not.toContain("reply N");
  inAgent(() => addDocWake(alias, me, wake("j".repeat(22), `@${me} a listen-hook line`)));
  const listener = spawn(agent, ["hook", "listen"], S, INPUT);
  expect(await listener.exited).toBe(2);
  const told = await new Response(listener.stderr).text();
  expect(told).toContain("a listen-hook line");
  expect(told).not.toContain("reply N");
});
