import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListening, daemonSock, stopDaemon } from "../src/daemon.ts";
import { CLIP_MIN, HOOK_CONTEXT_MAX, seatBudget } from "../src/hooks/answer.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(90_000);

type Env = Record<string, string>;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-reentry-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const claudeDir = scratch("claude");
const owner = scratch("owner");
const agent = scratch("agent");
let server: ReturnType<typeof startRelay> | undefined;
let me = "";

const S: Env = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "reentry", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" };
const start = (source: string) => JSON.stringify({ session_id: "reentry", cwd: agent, source, hook_event_name: "SessionStart" });

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

const context = async (source: string): Promise<string> => {
  const out = await ok(agent, ["hook", "session-start"], S, start(source));
  return (JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
};

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const code = /join code: (\S+)/.exec(await ok(owner, ["create", "reentry", "--as", "boss"]))![1]!;
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

test("a session that starts fresh is told its open task and checkpoint; a resumed one, which still holds them, is not", async () => {
  const added = await ok(agent, ["task", "add", "rotate the seats", "--owner", me], S);
  const id = /added (T\d+)/.exec(added)![1]!;
  await ok(agent, ["task", "start", id], S);
  expect(await context("startup")).toContain(`${id} “rotate the seats”: doing, yours`);
  const note = join(agent, "checkpoint.md");
  writeFileSync(note, "branch T-rotate at 1a2b3c\nnext: the flows test\n");
  expect(await ok(agent, ["task", "checkpoint", id, "--file", note], S)).toContain(`checkpoint saved: a new session of yours starts ${id} from it`);
  for (const source of ["startup", "clear", "compact"]) {
    const told = await context(source);
    expect(told).toContain(`${id} “rotate the seats”: doing, yours`);
    expect(told).toContain("  │ branch T-rotate at 1a2b3c\n  │ next: the flows test");
  }
  const resumed = await context("resume");
  expect(resumed).not.toContain("rotate the seats");
  expect(resumed).toContain(`You're "${me}" in channel "reentry"`);
  expect(resumed).not.toContain("Your session may be cleared");
  expect(await ok(agent, ["task", "show", id], S)).toContain("(checkpoint): branch T-rotate at 1a2b3c");
});

test("big checkpoints and a backlog of messages stay inside Claude Code's inline limit, and every message left out comes with a later hook", async () => {
  const note = join(agent, "big.md");
  for (let i = 0; i < 4; i++) {
    const tid = /added (T\d+)/.exec(await ok(agent, ["task", "add", `big ${i}`, "--owner", me], S))![1]!;
    writeFileSync(note, `big ${i} where it stands\n${"w".repeat(3_500)}\n`);
    await ok(agent, ["task", "checkpoint", tid, "--file", note], S);
  }
  const sent = Array.from({ length: 6 }, (_, i) => `backlog-${i} ${"m".repeat(1_400)} end-of-${i}`);
  for (const body of sent) await ok(owner, ["send", "--to", me, body]);
  const told = await context("startup");
  expect(told.length).toBeLessThanOrEqual(seatBudget(1));
  expect(told).toContain("where it stands");
  const first = sent.filter((b) => told.includes(b));
  const cut = sent.filter((b) => !told.includes(b) && told.includes(b.slice(0, CLIP_MIN)));
  expect(cut.length).toBeLessThanOrEqual(1);
  if (cut.length) expect(told).toMatch(/\(#(\d+) is cut here: .* show \1 has all of it\)/);
  expect(first.length + cut.length).toBeLessThan(sent.length);
  const shown = (b: string, later: string) => told.includes(b) || cut.includes(b) || later.includes(b);
  let later = "";
  const end = Date.now() + 20_000;
  while (!sent.every((b) => shown(b, later)) && Date.now() < end) {
    const out = await ok(agent, ["hook", "prompt"], S, JSON.stringify({ session_id: "reentry", cwd: agent }));
    expect(out.length).toBeLessThanOrEqual(HOOK_CONTEXT_MAX);
    later += out;
    if (!out) await Bun.sleep(200);
  }
  expect(sent.filter((b) => !shown(b, later)).map((b) => b.slice(0, 12))).toEqual([]);
  for (const body of [...first, ...cut]) expect(later).not.toContain(body.slice(0, CLIP_MIN));
});

test("past the context line, the Stop hook asks once for a checkpoint of each open task while rotation is on, and again only after the context came back under it; with rotation off it never asks", async () => {
  const transcript = join(agent, "transcript.jsonl");
  const stop = async (used: number, active = false): Promise<string> => {
    const usage = { input_tokens: 1, cache_read_input_tokens: used - 101, cache_creation_input_tokens: 100, output_tokens: 5_000 };
    writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { model: "test-model", content: [], usage } }) + "\n");
    const out = await ok(
      agent,
      ["hook", "stop"],
      { ...S, TMUX: "", TMUX_PANE: "", TERM_PROGRAM: "" },
      JSON.stringify({ session_id: "reentry", cwd: agent, hook_event_name: "Stop", transcript_path: transcript, stop_hook_active: active }),
    );
    if (!out) return "";
    const said = JSON.parse(out) as { decision: string; reason: string };
    expect(said.decision).toBe("block");
    expect(said.reason.length).toBeLessThanOrEqual(seatBudget(1));
    return said.reason;
  };
  const line = "past the 250k line";
  expect(await stop(262_000)).not.toContain(line);
  expect(await ok(agent, ["rotate", "on"], S)).toContain("rotation is on");
  expect(await context("startup")).toContain("Your session may be cleared");
  expect(await stop(240_000)).not.toContain(line);
  expect(await stop(262_000, true)).not.toContain(line);
  const asked = await stop(262_000);
  expect(asked).toContain(`Your context is at 262k tokens, ${line}.`);
  const mine = [...asked.matchAll(/T\d+/g)].map((m) => m[0]);
  expect(mine.length).toBeGreaterThanOrEqual(5);
  expect(asked).toContain(`task checkpoint ${mine[0]} --file note.md`);
  expect(await stop(300_000)).not.toContain(line);
  expect(await stop(120_000, true)).not.toContain(line);
  expect(await stop(255_000)).toContain("Your context is at 255k tokens");
  await ok(agent, ["rotate", "off"], S);
});

test("only the lead writes a lead checkpoint, and an empty one is refused before anything is sent", async () => {
  const note = join(agent, "lead-note.md");
  writeFileSync(note, "waiting on bo for T1\n");
  const refused = spawn(agent, ["task", "checkpoint", "lead", "--file", note], S);
  const [, err] = await Promise.all([new Response(refused.stdout).text(), new Response(refused.stderr).text()]);
  expect(await refused.exited).not.toBe(0);
  expect(err).toContain("only the lead writes a lead checkpoint");
  writeFileSync(note, "  \n");
  const empty = spawn(agent, ["task", "checkpoint", "lead", "--file", note], S);
  const [, said] = await Promise.all([new Response(empty.stdout).text(), new Response(empty.stderr).text()]);
  expect(await empty.exited).not.toBe(0);
  expect(said).toContain("usage: kiwi task checkpoint lead --file note.md");
  expect(await ok(agent, ["note"], S)).not.toContain("lead checkpoint");
});

test("with rotation on, a seat past the line rotates once it has checkpointed each open task, logging why it stays once per reason, and never logs or rotates while it is off", async () => {
  const transcript = join(agent, "rotate-transcript.jsonl");
  writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { model: "test-model", content: [], usage: { input_tokens: 300_000 } } }) + "\n");
  const log = join(agent, "rotate.log");
  const env = { ...S, CLAUDE_CODE_SESSION_ID: "rot-1", TMUX: `${join(agent, "no-tmux.sock")},1,0`, TMUX_PANE: "%9" };
  const stop = () => ok(agent, ["hook", "stop"], env, JSON.stringify({ session_id: "rot-1", cwd: agent, hook_event_name: "Stop", transcript_path: transcript }));
  const logged = () => (existsSync(log) ? readFileSync(log, "utf8") : "");
  const rotated = () => logged().includes("session rot-1 pane %9: no-tmux");
  const stays = () =>
    logged()
      .split("\n")
      .filter((l) => l.includes("session rot-1 pane %9: stays ("));
  expect(await stop()).toBe("");
  await Bun.sleep(1_500);
  expect(logged()).toBe("");
  expect(await ok(agent, ["rotate", "on"], S)).toContain("rotation is on");
  const asked = (JSON.parse(await stop()) as { reason: string }).reason;
  expect(asked).toContain("past the 250k line");
  expect(await stop()).toBe("");
  await Bun.sleep(1_500);
  expect(rotated()).toBe(false);
  expect(stays()).toHaveLength(1);
  expect(stays()[0]).toEndWith(`/${me}): past the line, waiting for a checkpoint on each open task`);
  const note = join(agent, "rotate-note.md");
  writeFileSync(note, "branch T-x at abc\nnext: rotate\n");
  const ids = new Set([...asked.matchAll(/T\d+/g)].map((m) => m[0]));
  await Promise.all([...ids].map((id) => ok(agent, ["task", "checkpoint", id, "--file", note], S)));
  expect(await stop()).toBe("");
  await until(async () => rotated(), "the sender's line in rotate.log", 10_000);
  expect(readFileSync(log, "utf8")).toContain("session rot-1 pane %9: no-tmux");
  await ok(agent, ["rotate", "off"], S);
});

test("the lead past the line is asked for its lead checkpoint, rotates only once it saved one naming everything open, and a fresh session of it starts from it", async () => {
  await ok(owner, ["--as", "human", "role", me, "lead", "--yes"], { CLAUDECODE: "" });
  await until(async () => (JSON.parse(await ok(agent, ["status", "--json"], S)) as { lead: string | null }).lead === me, "the seat leading");
  const transcript = join(agent, "lead-transcript.jsonl");
  writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { model: "test-model", content: [], usage: { input_tokens: 300_000 } } }) + "\n");
  const log = join(agent, "rotate.log");
  const env = { ...S, CLAUDE_CODE_SESSION_ID: "lead-1", TMUX: `${join(agent, "no-tmux.sock")},1,0`, TMUX_PANE: "%8" };
  const stop = () => ok(agent, ["hook", "stop"], env, JSON.stringify({ session_id: "lead-1", cwd: agent, hook_event_name: "Stop", transcript_path: transcript }));
  const mine = (line: string) => (existsSync(log) ? readFileSync(log, "utf8") : "").split("\n").filter((l) => l.includes("session lead-1 pane %8: ") && l.includes(line));
  expect(await ok(agent, ["rotate", "on"], S)).toContain("rotation is on");
  const asked = (JSON.parse(await stop()) as { reason: string }).reason;
  expect(asked).toMatch(/ task checkpoint lead --file note\.md`: every open task \(T7\) and question \(#123\) by its id/);
  const note = join(agent, "lead-tasks.md");
  writeFileSync(note, "branch T-x at abc\nnext: rotate\n");
  const owned = [...asked.split("; and where the channel stands")[0]!.matchAll(/T\d+/g)].map((m) => m[0]);
  expect(owned.length).toBeGreaterThan(0);
  await Promise.all(owned.map((id) => ok(agent, ["task", "checkpoint", id, "--file", note], S)));
  expect(await stop()).toBe("");
  await until(async () => mine("waiting for its lead checkpoint").length > 0, "the stay line");
  expect(mine("stays (").at(-1)).toEndWith(`/${me}): the lead, past the line, waiting for its lead checkpoint`);
  expect(mine("no-tmux")).toHaveLength(0);
  const lead = join(agent, "lead-note.md");
  writeFileSync(lead, "waiting on review\n");
  const partial = spawn(agent, ["task", "checkpoint", "lead", "--file", lead], S);
  const [, err] = await Promise.all([new Response(partial.stdout).text(), new Response(partial.stderr).text()]);
  expect(await partial.exited).not.toBe(0);
  const open = [...err.slice(err.indexOf("leaves out")).matchAll(/T\d+|#\d+/g)].map((m) => m[0]);
  expect(open).toEqual(expect.arrayContaining(owned));
  writeFileSync(lead, `LEAD-NOTE waiting on review of ${open.join(", ")}\nnext: merge order\n`);
  expect(await ok(agent, ["task", "checkpoint", "lead", "--file", lead], S)).toContain("lead checkpoint saved");
  expect(await stop()).toBe("");
  await until(async () => mine("no-tmux").length > 0, "the sender's line in rotate.log", 10_000);
  const told = await context("clear");
  expect(told).toMatch(/Your lead checkpoint, \S+ ago \(#\d+\):\n {2}│ LEAD-NOTE waiting on review of /);
  expect(told).toContain("next: merge order");
  await ok(agent, ["rotate", "off"], S);
});
