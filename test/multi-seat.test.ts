import { kiwiCmd } from "./owner.ts";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";
import { daemonListeners, daemonSock } from "../src/daemon.ts";
import { hookOutput } from "../src/hooks.ts";
import { HOOK_CONTEXT_MAX } from "../src/hooks/answer.ts";
import { startRelay } from "../src/relay/bun.ts";
import { seatsAt } from "../src/seats.ts";

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

async function joinAs(owner: string, joiner: string, code: string, name: string, env: Env, cwd = joiner): Promise<string> {
  const p = spawn(joiner, ["join", code, "--as", name, "--timeout", "40s"], env, cwd);
  let listed = "";
  await until(async () => {
    listed = await ok(owner, ["--as", "boss", "requests"], PERSON);
    return /\d{3}-\d{3}/.test(listed);
  }, `${name}'s join request`);
  await ok(owner, ["--as", "boss", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes"], PERSON);
  const [code_, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  if (code_ !== 0) throw new Error(`join as ${name} exited ${code_}: ${err}`);
  return err;
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
  const first = await joinAs(ownerA, h, codeA, "planner", S);
  const second = await joinAs(ownerB, h, codeB, "reviewer", S);
  return { ownerA, ownerB, h, codeB, joined: [first, second], input: JSON.stringify({ session_id: "M", cwd: h }) };
}

function seatsIn(h: string): string[] {
  const before = process.env.KIWI_HOME;
  process.env.KIWI_HOME = h;
  try {
    const cfg = loadConfig();
    return Object.keys(cfg.bindings ?? {})
      .flatMap((dir) => seatsAt(cfg, dir))
      .map((b) => `${b.as}:${b.alias}`)
      .sort();
  } finally {
    if (before === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = before;
  }
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
    expect(
      Object.values(config.bindings)
        .flat()
        .map((b) => `${b.as}:${b.session}`)
        .sort(),
    ).toEqual(["planner:M", "reviewer:M"]);

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
    expect(stop.reason).toContain("unread Kiwi Channels messages for you (alpha)");
    expect(stop.reason).toContain("unread Kiwi Channels messages for you (beta)");

    const bare = await run(h, ["listen", "--now"], S);
    expect(bare.code).toBe(1);
    expect(bare.err).toContain("this session is several agents here (planner in alpha, reviewer in beta)");
    await ok(ownerB, ["send", "--to", "reviewer", "read by name"], PERSON);
    expect(await ok(h, ["--as", "reviewer", "listen", "--now"], S)).toContain("read by name");
    await ok(ownerB, ["send", "--to", "reviewer", "read by channel"], PERSON);
    expect(await ok(h, ["-c", "beta", "listen", "--now"], S)).toContain("read by channel");
    const empty = await run(h, ["-c", "beta", "listen", "--now"], S);
    expect(empty.code).toBe(0);
    expect(empty.out).toBe("");
    expect(empty.err).toMatch(/nothing unread; `[^`]* -c beta --as reviewer log -n 10` shows what was already delivered/);
  });

  test("a session that holds neither seat, in a folder with seats in two channels, is told both channels and how to pick", async () => {
    const { h } = await twoSeats();
    const restarted = await run(h, ["log"], { ...S, CLAUDE_CODE_SESSION_ID: "N" });
    expect(restarted.code).toBe(1);
    expect(restarted.err).toContain("this folder has seats in alpha and beta (planner in alpha, reviewer in beta): pass -c ALIAS --as NAME to say which");
    expect(restarted.err).not.toContain("isn't bound to a channel");
  });

  test("joining a second channel from a folder that has a seat in another says which flags pick each seat, and binds both", async () => {
    const { h, joined } = await twoSeats();
    expect(joined[0]).not.toContain("this folder now has seats in");
    expect(joined[1]).toContain("kiwi: this folder now has seats in alpha and beta, so commands from it need -c beta --as reviewer (or -c alpha --as planner) to pick one\n");
    expect(seatsIn(h)).toEqual(["planner:alpha", "reviewer:beta"]);
  });

  test("rejoining a channel the folder already has a seat in says nothing about picking one", async () => {
    const { h, codeB } = await twoSeats();
    const rejoined = await run(h, ["join", codeB, "--as", "reviewer", "--timeout", "40s"], S);
    expect(rejoined.code).toBe(0);
    expect(rejoined.err).toContain('back in "beta" as reviewer');
    expect(rejoined.err).not.toContain("this folder now has seats in");
    expect(seatsIn(h)).toEqual(["planner:alpha", "reviewer:beta"]);
  });

  test("with a backlog on both seats, each hook's whole output stays inside Claude Code's inline limit", async () => {
    const { ownerA, ownerB, h, input } = await twoSeats();
    for (let i = 0; i < 5; i++) {
      await ok(ownerA, ["send", "--to", "planner", `alpha-backlog-${i} ${"a".repeat(1_500)}`], PERSON);
      await ok(ownerB, ["send", "--to", "reviewer", `beta-backlog-${i} ${"b".repeat(1_500)}`], PERSON);
    }
    const listening = spawn(h, ["hook", "listen"], S, h, input);
    expect(await listening.exited).toBe(2);
    const woke = await new Response(listening.stderr).text();
    expect(woke.trimEnd().length).toBeLessThanOrEqual(HOOK_CONTEXT_MAX);
    expect(woke).toContain("alpha-backlog-0");
    expect(woke).toContain("beta-backlog-0");
    expect(woke).toContain("more unread: they come next");
    const started = await run(h, ["hook", "session-start"], S, h, JSON.stringify({ session_id: "M", cwd: h, source: "startup" }));
    expect({ code: started.code, err: started.err, empty: started.out === "" }).toEqual({ code: 0, err: "", empty: false });
    const start = JSON.parse(started.out) as {
      hookSpecificOutput: { additionalContext: string };
    };
    expect(start.hookSpecificOutput.additionalContext.length).toBeLessThanOrEqual(HOOK_CONTEXT_MAX);
    expect(start.hookSpecificOutput.additionalContext).toContain("planner");
    expect(start.hookSpecificOutput.additionalContext).toContain("reviewer");
    expect(start.hookSpecificOutput.additionalContext).toContain("Unread messages for you (alpha):\n");
    expect(start.hookSpecificOutput.additionalContext).toContain("Unread messages for you (beta):\n");
    const prompt = (await run(h, ["hook", "prompt"], S, h, input)).out;
    expect(prompt.length).toBeLessThanOrEqual(HOOK_CONTEXT_MAX);
    expect(prompt).toContain("alpha-backlog-");
    expect(prompt).toContain("beta-backlog-");
    for (let i = 0; i < 5; i++) {
      await ok(ownerA, ["send", "--to", "planner", `alpha-late-${i} ${"a".repeat(1_500)}`], PERSON);
      await ok(ownerB, ["send", "--to", "reviewer", `beta-late-${i} ${"b".repeat(1_500)}`], PERSON);
    }
    const stop = JSON.parse((await run(h, ["hook", "stop"], S, h, JSON.stringify({ session_id: "M", cwd: h, hook_event_name: "Stop" }))).out) as { reason: string };
    expect(stop.reason.length).toBeLessThanOrEqual(HOOK_CONTEXT_MAX);
    expect(stop.reason).toContain("alpha-late-0");
    expect(stop.reason).toContain("beta-late-0");
  });

  test("replying to a message the session was shown picks its seat, with no flags", async () => {
    const { ownerA, ownerB, h, input } = await twoSeats();
    const sent = await ok(ownerB, ["send", "--to", "reviewer", "which seat am I"], PERSON);
    const seq = /#(\d+)/.exec(sent)![1]!;
    const before = await run(h, ["reply", seq, "from nobody yet"], S);
    expect(before.code).toBe(1);
    expect(before.err).toContain("this session is several agents here");
    expect((await run(h, ["hook", "prompt"], S, h, input)).out).toContain("which seat am I");
    await ok(h, ["reply", seq, "from the seat that heard it"], S);
    const log = await ok(ownerB, ["--as", "boss", "log"], PERSON);
    expect(log).toContain("reviewer");
    expect(log).toContain("from the seat that heard it");
    expect(await ok(ownerA, ["--as", "boss", "log"], PERSON)).not.toContain("from the seat that heard it");
  });

  test("replying from a folder bound to one seat goes to the channel the session heard the message in", async () => {
    const ownerA = scratch("own-a-heard");
    const ownerB = scratch("own-b-heard");
    const codeA = created(await ok(ownerA, ["create", "alpha", "--as", "boss"], PERSON));
    const codeB = created(await ok(ownerB, ["create", "beta", "--as", "boss"], PERSON));
    const h = scratch("agent-heard");
    const elsewhere = join(h, "elsewhere");
    mkdirSync(elsewhere, { recursive: true });
    await joinAs(ownerA, h, codeA, "planner", S, elsewhere);
    await joinAs(ownerB, h, codeB, "reviewer", S);
    const sent = await ok(ownerA, ["send", "--to", "planner", "heard in alpha"], PERSON);
    const seq = /#(\d+)/.exec(sent)![1]!;
    expect((await run(h, ["hook", "prompt"], S, h, JSON.stringify({ session_id: "M", cwd: h }))).out).toContain("heard in alpha");
    await ok(h, ["reply", seq, "answered where it was heard"], S);
    expect(await ok(ownerA, ["--as", "boss", "log"], PERSON)).toContain("answered where it was heard");
    expect(await ok(ownerB, ["--as", "boss", "log"], PERSON)).not.toContain("answered where it was heard");
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

describe("a seat whose own `kiwi listen` takes its messages", () => {
  test("listen --now, finding nothing unread, says that listener runs and already took them (#1170)", async () => {
    const { ownerB, h } = await twoSeats();
    const tail = spawn(h, ["-c", "beta", "--as", "reviewer", "listen"], S);
    let printed = "";
    void (async () => {
      for await (const chunk of tail.stdout) printed += new TextDecoder().decode(chunk);
    })();
    try {
      await until(async () => (await slots(h)).includes("listen:reviewer"), "the listener's slot");
      await ok(ownerB, ["send", "--to", "reviewer", "taken by the listener"], PERSON);
      await until(() => printed.includes("taken by the listener"), "the listener printing the message");
      const now = await run(h, ["-c", "beta", "--as", "reviewer", "listen", "--now"], S);
      expect(now.code).toBe(0);
      expect(now.out).toBe("");
      expect(now.err).toContain("nothing unread: a Kiwi listener for reviewer is running (`kiwi listen` or `kiwi watch`, since");
      expect(now.err).toContain("marks each message read as it hands it on, so those won't show as unread here");
      expect(now.err).toMatch(/`[^`]* -c beta --as reviewer log -n 10` shows the latest/);
    } finally {
      tail.kill();
      await tail.exited;
    }
  });

  test("a hook listener, which marks nothing read, isn't taken for one, even when its session comes only from the hook's input", async () => {
    const { h, input } = await twoSeats();
    const hook = spawn(h, ["hook", "listen"], { ...S, CLAUDE_CODE_SESSION_ID: "" }, h, input);
    try {
      await until(async () => (await slots(h)).includes("hook:reviewer"), "the hook's slot");
      await until(async () => (await slots(h)).includes("listen:reviewer"), "the hook's listener");
      const now = await run(h, ["-c", "beta", "--as", "reviewer", "listen", "--now"], S);
      expect(now.code).toBe(0);
      expect(now.err).toMatch(/^nothing unread; `[^`]* -c beta --as reviewer log -n 10` shows what was already delivered/);
    } finally {
      hook.kill();
      await hook.exited;
    }
  });

  test("a `kiwi listen` beside the session's hook listener is still named", async () => {
    const { h, input } = await twoSeats();
    const hook = spawn(h, ["hook", "listen"], S, h, input);
    const tail = spawn(h, ["-c", "beta", "--as", "reviewer", "listen"], S);
    try {
      await until(async () => (await slots(h)).filter((s) => s === "listen:reviewer").length === 2, "the hook's and the tail's listeners");
      const now = await run(h, ["-c", "beta", "--as", "reviewer", "listen", "--now"], S);
      expect(now.code).toBe(0);
      expect(now.err).toContain("nothing unread: a Kiwi listener for reviewer is running");
    } finally {
      hook.kill();
      tail.kill();
      await Promise.all([hook.exited, tail.exited]);
    }
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
  expect(
    hookOutput([
      { kind: "prompt", text: "a" },
      { kind: "prompt", text: "b" },
    ]),
  ).toBe("a\n\nb");
  expect(
    JSON.parse(
      hookOutput([
        { kind: "block", text: "a" },
        { kind: "block", text: "b" },
      ]) ?? "",
    ),
  ).toEqual({ decision: "block", reason: "a\n\nb" });
  expect(JSON.parse(hookOutput([{ kind: "start", text: "a" }]) ?? "")).toEqual({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "a" } });
  expect(
    JSON.parse(
      hookOutput([
        { kind: "followup", text: "a" },
        { kind: "followup", text: "b" },
      ]) ?? "",
    ),
  ).toEqual({ followup_message: "a b" });
});
