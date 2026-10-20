import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListening, daemonSock, stopDaemon } from "../src/daemon.ts";
import { startRelay } from "../src/relay/bun.ts";
import { kiwiCmd } from "./owner.ts";

setDefaultTimeout(90_000);

type Env = Record<string, string>;

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-persona-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const claudeDir = scratch("claude");
const owner = scratch("owner");
const agent = scratch("agent");
let server: ReturnType<typeof startRelay> | undefined;
let me = "";

const session = (id: string): Env => ({ CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: id, CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" });
const S = session("persona");

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
    await Bun.sleep(100);
  }
}

const prompt = (env: Env = S) => ok(agent, ["hook", "prompt"], env, JSON.stringify({ session_id: env.CLAUDE_CODE_SESSION_ID, cwd: agent }));
const stop = async (env: Env = S): Promise<string> => {
  const out = await ok(agent, ["hook", "stop"], env, JSON.stringify({ session_id: env.CLAUDE_CODE_SESSION_ID, cwd: agent, hook_event_name: "Stop" }));
  return out ? (JSON.parse(out) as { reason: string }).reason : "";
};
const role = (name: string, about?: string) => ok(owner, ["--as", "human", "role", me, name, ...(about === undefined ? [] : ["--about", about])], { CLAUDECODE: "" });
const CHANGED = "The owner changed your personality:";

async function toldBy(hook: () => Promise<string>, says: string): Promise<string> {
  let out = "";
  await until(async () => (out = await hook()).includes(says), `a hook that says ${JSON.stringify(says)}`);
  return out;
}

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  const code = /join code: (\S+)/.exec(await ok(owner, ["create", "persona", "--as", "boss"]))![1]!;
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

test("an agent given a personality mid-session is told it at its next hook, once", async () => {
  expect(await prompt()).not.toContain(CHANGED);
  await role("Reviewer", "Use a sub agent for each review.");
  const told = await toldBy(prompt, CHANGED);
  expect(told).toContain(`${CHANGED}\nYou are now Reviewer (Builder).`);
  expect(told).toContain("Your instructions: Use a sub agent for each review.");
  expect(told.indexOf(CHANGED)).toBe(0);
  expect(await prompt()).not.toContain(CHANGED);
  expect(await stop()).not.toContain(CHANGED);
});

test("a change between turns stops the turn once to say it; taking it away is told too", async () => {
  await role("Reviewer", "Review alone, then post the verdict.");
  const reason = await toldBy(stop, CHANGED);
  expect(reason).toContain("Your instructions: Review alone, then post the verdict.");
  expect(await stop()).not.toContain(CHANGED);
  expect(await prompt()).not.toContain(CHANGED);
  await role("none");
  expect(await toldBy(prompt, "took your personality away")).toContain("The owner took your personality away: its role and instructions no longer apply.");
  expect(await prompt()).not.toContain("took your personality away");
});

test("a new session reads its personality in the brief, and its first hooks don't repeat it", async () => {
  await role("Reviewer", "Third rule.");
  await toldBy(prompt, "Third rule.");
  const next = session("persona-next");
  const start = await ok(agent, ["hook", "session-start"], next, JSON.stringify({ session_id: "persona-next", cwd: agent, source: "startup", hook_event_name: "SessionStart" }));
  const brief = (JSON.parse(start) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
  expect(brief).toContain("You join as Reviewer (Builder).");
  expect(brief).toContain("Your instructions: Third rule.");
  expect(await prompt(next)).not.toContain(CHANGED);
  expect(await stop(next)).not.toContain(CHANGED);
});
