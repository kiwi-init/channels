import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { daemonListeners, daemonSock } from "../src/daemon.ts";
import { hookOutput } from "../src/hooks.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const dataDir = mkdtempSync(join(tmpdir(), "kiwi-ms-relay-"));
const claudeDir = mkdtempSync(join(tmpdir(), "kiwi-ms-claude-"));
const made: string[] = [dataDir, claudeDir];
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";

beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-ms-${tag}-`));
  made.push(d);
  return d;
};

type Env = Record<string, string>;

function spawn(home: string, args: string[], env: Env = {}, cwd = home, stdin?: string) {
  return Bun.spawn(kiwiCmd(args), {
    cwd,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, CLAUDE_CONFIG_DIR: claudeDir, CLAUDE_PROJECT_DIR: "", KIWI_MODEL: "test-model", ...env },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function run(home: string, args: string[], env: Env = {}, cwd = home, stdin?: string) {
  const p = spawn(home, args, env, cwd, stdin);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out, err };
}

async function ok(home: string, args: string[], env: Env = {}, cwd = home): Promise<string> {
  const r = await run(home, args, env, cwd);
  if (r.code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r.out;
}

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

const PERSON = { CLAUDECODE: "" };

async function joinAs(owner: string, joiner: string, code: string, name: string, env: Env, cwd = joiner): Promise<void> {
  const p = spawn(joiner, ["join", code, "--as", name, "--timeout", "40s"], env, cwd);
  let listed = "";
  await until(async () => {
    listed = await ok(owner, ["--as", "boss", "requests"], PERSON);
    return /\d{3}-\d{3}/.test(listed);
  }, `${name}'s join request`);
  await ok(owner, ["--as", "boss", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"], PERSON);
  const code_ = await p.exited;
  if (code_ !== 0) throw new Error(`join as ${name} exited ${code_}: ${await new Response(p.stderr).text()}`);
}

function created(out: string): string {
  return /join code: (\S+)/.exec(out)![1]!;
}

const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "M", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent" };

async function twoSeats() {
  const ownerA = scratch("own-a");
  const ownerB = scratch("own-b");
  const codeA = created(await ok(ownerA, ["create", "alpha", "--as", "boss"], PERSON));
  const codeB = created(await ok(ownerB, ["create", "beta", "--as", "boss"], PERSON));
  const h = scratch("agent");
  await joinAs(ownerA, h, codeA, "planner", S);
  await joinAs(ownerB, h, codeB, "reviewer", S);
  return { ownerA, ownerB, h, input: JSON.stringify({ session_id: "M", cwd: h }) };
}

async function slots(h: string): Promise<string[]> {
  return (await daemonListeners(daemonSock(h)).catch(() => [])).map((l) => `${l.kind}:${l.agent}`);
}

async function hookSlots(h: string): Promise<string[]> {
  return (await slots(h)).filter((s) => s.startsWith("hook:")).map((s) => s.slice("hook:".length));
}

describe("one Claude Code session that holds two seats", () => {
  test("its hooks serve both seats, and the bare CLI names both instead of picking one", async () => {
    const { ownerA, ownerB, h } = await twoSeats();
    const config = JSON.parse(readFileSync(join(h, "config.json"), "utf8")) as { bindings: Record<string, { as: string; session?: string }[]> };
    expect(Object.values(config.bindings).flat().map((b) => `${b.as}:${b.session}`).sort()).toEqual(["planner:M", "reviewer:M"]);

    const input = JSON.stringify({ session_id: "M", cwd: h });
    const start = (await run(h, ["hook", "session-start"], S, h, input)).out;
    expect(start).toContain("planner");
    expect(start).toContain("reviewer");

    const listening = spawn(h, ["hook", "listen"], S, h, input);
    await until(async () => {
      const held = await hookSlots(h);
      return held.includes("planner") && held.includes("reviewer");
    }, "one listener holding both seats");
    expect((await run(h, ["hook", "listen"], S, h, input)).code).toBe(0);
    await ok(ownerB, ["send", "--to", "reviewer", "wake the second seat"], PERSON);
    expect(await listening.exited).toBe(2);
    const woke = await new Response(listening.stderr).text();
    expect(woke).toContain("boss → reviewer: wake the second seat");
    expect(woke).toContain("-c beta --as reviewer reply N");

    await ok(ownerA, ["send", "--to", "planner", "for the first seat"], PERSON);
    await ok(ownerB, ["send", "--to", "reviewer", "for the second seat"], PERSON);
    const stop = JSON.parse((await run(h, ["hook", "stop"], S, h, JSON.stringify({ session_id: "M", cwd: h, hook_event_name: "Stop" }))).out) as { decision: string; reason: string };
    expect(stop.decision).toBe("block");
    expect(stop.reason).toContain("for the first seat");
    expect(stop.reason).toContain("for the second seat");
    expect(stop.reason).toContain("-c alpha --as planner reply N");
    expect(stop.reason).toContain("-c beta --as reviewer reply N");

    const bare = await run(h, ["listen", "--now"], S);
    expect(bare.code).toBe(1);
    expect(bare.err).toContain("this session is several agents here (planner in alpha, reviewer in beta)");
    await ok(ownerB, ["send", "--to", "reviewer", "read by name"], PERSON);
    expect(await ok(h, ["--as", "reviewer", "listen", "--now"], S)).toContain("read by name");
    await ok(ownerB, ["send", "--to", "reviewer", "read by channel"], PERSON);
    expect(await ok(h, ["-c", "beta", "listen", "--now"], S)).toContain("read by channel");
  });

  test("a seat whose relay hangs doesn't hold back the other seat's answer", async () => {
    const { ownerA, h, input } = await twoSeats();
    await run(h, ["hook", "session-start"], S, h, input);
    await ok(ownerA, ["send", "--to", "planner", "answered while the other seat hangs"], PERSON);
    const path = join(h, "config.json");
    const original = readFileSync(path, "utf8");
    const cfg = JSON.parse(original) as { channels: Record<string, { relay: string }> };
    const hanging = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 60, fetch: () => new Promise<Response>(() => {}) });
    cfg.channels.beta!.relay = hanging.url.origin;
    writeFileSync(path, JSON.stringify(cfg));
    try {
      const prompt = await run(h, ["hook", "prompt"], S, h, input);
      expect(prompt.out).toContain("answered while the other seat hangs");
    } finally {
      hanging.stop(true);
      writeFileSync(path, original);
    }
  });

  test("a closed channel leaves the other seat listening", async () => {
    const { ownerA, ownerB, h, input } = await twoSeats();
    await ok(ownerB, ["close", "--yes"], PERSON);
    const listening = spawn(h, ["hook", "listen"], S, h, input);
    await until(async () => (await hookSlots(h)).includes("planner"), "the healthy seat's slot");
    await ok(ownerA, ["send", "--to", "planner", "still heard"], PERSON);
    expect(await listening.exited).toBe(2);
    expect(await new Response(listening.stderr).text()).toContain("boss → planner: still heard");
  });

  test("a seat that can't open gives its slot back, so the next hook listens for it", async () => {
    const { ownerA, ownerB, h, input } = await twoSeats();
    const cfg = JSON.parse(readFileSync(join(h, "config.json"), "utf8")) as { channels: Record<string, { roomId: string }> };
    const key = join(h, "identities", cfg.channels.beta!.roomId, "reviewer.json");
    const saved = readFileSync(key, "utf8");
    rmSync(key);
    const first = spawn(h, ["hook", "listen"], S, h, input);
    await until(async () => {
      const held = await slots(h);
      return held.includes("listen:planner") && !held.some((s) => s.endsWith(":reviewer"));
    }, "the first hook listening for the healthy seat, after giving the broken one's slot back");
    writeFileSync(key, saved);
    const second = spawn(h, ["hook", "listen"], S, h, input);
    await until(async () => (await hookSlots(h)).includes("reviewer"), "the restored seat's slot");
    await ok(ownerB, ["send", "--to", "reviewer", "heard after the key came back"], PERSON);
    expect(await second.exited).toBe(2);
    expect(await new Response(second.stderr).text()).toContain("boss → reviewer: heard after the key came back");
    await ok(ownerA, ["send", "--to", "planner", "ends the first listener"], PERSON);
    expect(await first.exited).toBe(2);
  });
});

describe("one Claude Code session that joined its second seat from another folder", () => {
  test("its hooks, run from the folder the session started in, serve both seats", async () => {
    const ownerA = scratch("own-a");
    const ownerB = scratch("own-b");
    const codeA = created(await ok(ownerA, ["create", "alpha", "--as", "boss"], PERSON));
    const codeB = created(await ok(ownerB, ["create", "beta", "--as", "boss"], PERSON));
    const h = scratch("agent");
    const project = scratch("project");
    const task = scratch("task");
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "X", CLAUDE_PID: String(process.pid), AI_AGENT: "claude-code_2-1-296_agent", CLAUDE_PROJECT_DIR: project };
    await joinAs(ownerA, h, codeA, "planner", S, project);
    await joinAs(ownerB, h, codeB, "reviewer", S, task);
    const config = JSON.parse(readFileSync(join(h, "config.json"), "utf8")) as { bindings: Record<string, { as: string; session?: string }> };
    expect([...new Set(Object.keys(config.bindings).map((d) => realpathSync(d)))].sort()).toEqual([realpathSync(project), realpathSync(task)].sort());

    const input = JSON.stringify({ session_id: "X", cwd: project });
    const start = (await run(h, ["hook", "session-start"], S, project, input)).out;
    expect(start).toContain("planner");
    expect(start).toContain("reviewer");

    const listening = spawn(h, ["hook", "listen"], S, project, input);
    await until(async () => {
      const held = (await daemonListeners(daemonSock(h)).catch(() => [])).filter((l) => l.kind === "hook").map((l) => l.agent);
      return held.includes("planner") && held.includes("reviewer");
    }, "one listener holding the seat from the other folder");
    await ok(ownerB, ["send", "--to", "reviewer", "wake the seat from the task folder"], PERSON);
    expect(await listening.exited).toBe(2);
    const woke = await new Response(listening.stderr).text();
    expect(woke).toContain("boss → reviewer: wake the seat from the task folder");
    expect(woke).toContain("-c beta --as reviewer reply N");

    await ok(ownerB, ["send", "--to", "reviewer", "still unread at stop"], PERSON);
    const stop = JSON.parse((await run(h, ["hook", "stop"], S, project, JSON.stringify({ session_id: "X", cwd: project, hook_event_name: "Stop" }))).out) as { decision: string; reason: string };
    expect(stop.decision).toBe("block");
    expect(stop.reason).toContain("still unread at stop");
    expect(stop.reason).toContain("-c beta --as reviewer reply N");

    const other = { ...S, CLAUDE_CODE_SESSION_ID: "Y" };
    await ok(ownerB, ["send", "--to", "reviewer", "not for another session"], PERSON);
    expect((await run(h, ["hook", "prompt"], other, project, JSON.stringify({ session_id: "Y", cwd: project }))).out).not.toContain("not for another session");
  });
});

test("answers from several seats make one hook answer of the same shape", () => {
  expect(hookOutput([])).toBeNull();
  expect(hookOutput([{ kind: "prompt", text: "a" }])).toBe("a");
  expect(hookOutput([{ kind: "prompt", text: "a" }, { kind: "prompt", text: "b" }])).toBe("a\n\nb");
  expect(JSON.parse(hookOutput([{ kind: "block", text: "a" }, { kind: "block", text: "b" }]) ?? "")).toEqual({ decision: "block", reason: "a\n\nb" });
  expect(JSON.parse(hookOutput([{ kind: "start", text: "a" }]) ?? "")).toEqual({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "a" } });
  expect(JSON.parse(hookOutput([{ kind: "followup", text: "a" }, { kind: "followup", text: "b" }]) ?? "")).toEqual({ followup_message: "a b" });
});
