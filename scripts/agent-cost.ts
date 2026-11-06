import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListening, daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "../test/owner.ts";

type Env = Record<string, string>;

interface Step {
  intent: string;
  calls: number;
  chars: number;
  shown: string;
}

const made: string[] = [];
const scratch = (tag: string): string => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-agent-cost-${tag}-`));
  made.push(d);
  return d;
};

const report = process.argv.find((a) => a.startsWith("--out="))?.slice("--out=".length);
const asJson = process.argv.includes("--json");
const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir: scratch("relay") });
const relay = server.url.origin;
const claudeDir = scratch("claude");
const owner = scratch("owner");
const agentA = scratch("a");
const agentB = scratch("b");
const steps: Step[] = [];

const session = (id: string): Env => ({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: id, CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" });

function spawn(home: string, args: string[], env: Env, stdin?: string) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: "", KIWI_MODEL: "claude-opus-5-5", ...env },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(home: string, args: string[], env: Env = {}, stdin?: string): Promise<{ code: number; text: string }> {
  const p = spawn(home, args, env, stdin);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, text: out + err };
}

async function ok(home: string, args: string[], env: Env = {}, stdin?: string): Promise<string> {
  const r = await run(home, args, env, stdin);
  if (r.code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${r.code}: ${r.text}`);
  return r.text;
}

const asOwner = (args: string[]): Promise<string> => ok(owner, args, { CLAUDECODE: "" });

async function until(pred: () => Promise<boolean>, label: string, ms = 30_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

function record(intent: string, outputs: string[]): string {
  const shown = outputs.join("\n");
  steps.push({ intent, calls: outputs.length, chars: shown.length, shown });
  return shown;
}

async function agentDoes(home: string, id: string, intent: string, commands: (string[] | { args: string[]; stdin: string })[]): Promise<string> {
  const outputs: string[] = [];
  for (const c of commands) {
    const args = Array.isArray(c) ? c : c.args;
    const r = await run(home, args, session(id), Array.isArray(c) ? undefined : c.stdin);
    outputs.push(`$ kiwi ${args.join(" ")}\n${r.text}`);
  }
  return record(intent, outputs);
}

const hook = (home: string, id: string, event: string): Promise<string> => ok(home, ["hook", event], session(id), JSON.stringify({ session_id: id, cwd: home }));

async function joinAs(home: string, id: string, code: string): Promise<{ handle: string; text: string }> {
  const joining = spawn(home, ["join", code, "--timeout", "60s"], session(id));
  const said = Promise.all([new Response(joining.stdout).text(), new Response(joining.stderr).text()]).then(([o, e]) => o + e);
  let listed = "";
  await until(async () => {
    listed = await asOwner(["--as", "human", "requests"]);
    return /\d{3}-\d{3}/.test(listed);
  }, "the join request");
  await asOwner(["--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"]);
  if ((await joining.exited) !== 0) throw new Error(`join failed: ${await said}`);
  const text = await said;
  const handle = /You're "([^"]+)"/.exec(text)?.[1];
  if (!handle) throw new Error(`no handle in the join output:\n${text}`);
  await until(async () => (await daemonListening(daemonSock(home)).catch(() => [])).some((s) => s.agent === handle), `${handle}'s daemon`);
  return { handle, text };
}

const lastSeq = async (home: string, id: string): Promise<number> => {
  const lines = (await ok(home, ["log", "-n", "1", "--json"], session(id))).trim().split("\n");
  return (JSON.parse(lines.at(-1)!) as { seq: number }).seq;
};

try {
  const code = /join code: (\S+)/.exec(await asOwner(["create", "cost", "--as", "boss"]))![1]!;
  const a = await joinAs(agentA, "sa", code);
  record("join (what the agent reads from kiwi join)", [a.text]);
  const b = await joinAs(agentB, "sb", code);

  record("session start (hook)", [await hook(agentA, "sa", "session-start")]);
  await hook(agentA, "sa", "prompt");
  await hook(agentA, "sa", "stop");
  record("an idle turn (prompt + stop hooks)", [await hook(agentA, "sa", "prompt"), await hook(agentA, "sa", "stop")]);

  const body = "Can you look at the login bug on staging? Users get logged out after a minute.";
  await asOwner(["send", "--to", a.handle, body]);
  const one = record("one direct message arrives (prompt hook)", [await hook(agentA, "sa", "prompt")]);
  if (!asJson) console.log(`  the message itself: ${body.length} chars; Kiwi's wrapping: ${one.length - body.length} chars`);
  const dm = await lastSeq(agentA, "sa");

  const bodies = Array.from({ length: 10 }, (_, i) => `Status update ${i + 1}: the deploy pipeline step ${i + 1} finished fine.`);
  for (const t of bodies) await asOwner(["send", t]);
  for (let i = 0; i < 5; i++) await ok(agentB, ["send", `Agent note ${i + 1}: tests on branch fix-${i + 1} pass.`], session("sb"));
  const burst = record("15 messages arrive at once (prompt hook)", [await hook(agentA, "sa", "prompt")]);
  const burstBodies = bodies.join("").length + 5 * "Agent note 1: tests on branch fix-1 pass.".length;
  if (!asJson) console.log(`  the 15 messages: ~${burstBodies} chars; Kiwi's wrapping: ~${burst.length - burstBodies} chars`);

  await agentDoes(agentA, "sa", "reply to a message", [["reply", String(dm), "On it: I can reproduce it, the session cookie expires after 60s."]]);
  await agentDoes(agentA, "sa", "post an update", [["send", "Login fix is up for review."]]);
  await agentDoes(agentA, "sa", "post text with backticks (heredoc)", [{ args: ["send"], stdin: "Run `bun test` before merging; `$HOME/.kiwi` holds the config." }]);

  await asOwner(["send", "--to", "all", "Who can review PR 12 today?"]);
  await hook(agentA, "sa", "prompt");
  const toAll = await lastSeq(agentA, "sa");
  await agentDoes(agentA, "sa", "answer a message sent to everyone", [["reply", String(toAll), "I'll take PR 12."]]);
  await agentDoes(agentB, "sb", "a second agent answers it too", [["reply", String(toAll), "I can review it."]]);

  const ask = await lastSeq(agentA, "sa");
  await asOwner(["--as", "human", "send", "Please make the login session last a day."]);
  const askSeq = await lastSeq(agentA, "sa");
  const added = await agentDoes(agentA, "sa", "file a task", [["task", "add", "Session lasts a day", "--ask", String(askSeq)]]);
  const task = /\bT\d+\b/.exec(added.split("\n").slice(1).join("\n"))?.[0];
  if (!task) throw new Error(`no task id in:\n${added}`);
  await agentDoes(agentA, "sa", "take a task", [["task", "start", task]]);
  await agentDoes(agentA, "sa", "ask a person to decide", [["ask-human", "--holds", task, "--option", "A: one day", "--option", "B: one week", "How long should a session last?"]]);
  await agentDoes(agentA, "sa", "finish a task", [["task", "done", task]]);
  await agentDoes(agentA, "sa", "see who's here and what's open", [["status"]]);
  await agentDoes(agentA, "sa", "read recent history", [["log", "-n", "30"]]);
  await agentDoes(agentA, "sa", "read one message in full", [["show", String(ask)]]);
  await agentDoes(agentA, "sa", "read the help the brief points to", [["help"]]);
  await agentDoes(agentA, "sa", "read one command's options", [["help", "send"]]);

  record("end of a working turn (stop hook)", [await hook(agentA, "sa", "stop")]);

  if (asJson) {
    console.log(JSON.stringify(steps.map(({ intent, calls, chars, shown }) => ({ intent, calls, chars, shown }))));
  }
  const tokens = (chars: number): number => Math.ceil(chars / 4);
  const width = Math.max(...steps.map((s) => s.intent.length));
  const print = (line: string): void => {
    if (!asJson) console.log(line);
  };
  print(`\n${"intent".padEnd(width)}  calls   chars  ~tokens`);
  for (const s of steps) print(`${s.intent.padEnd(width)}  ${String(s.calls).padStart(5)}  ${String(s.chars).padStart(6)}  ${String(tokens(s.chars)).padStart(7)}`);
  const total = steps.reduce((n, s) => n + s.chars, 0);
  print(`${"total".padEnd(width)}  ${String(steps.reduce((n, s) => n + s.calls, 0)).padStart(5)}  ${String(total).padStart(6)}  ${String(tokens(total)).padStart(7)}`);
  if (report) writeFileSync(report, steps.map((s) => `===== ${s.intent} (${s.calls} calls, ${s.chars} chars)\n${s.shown}`).join("\n\n"));
  print(`\n(${b.handle} was the second agent)`);
} finally {
  await Promise.all([agentA, agentB].map((h) => stopDaemon(daemonSock(h)).catch(() => undefined)));
  server.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
}
