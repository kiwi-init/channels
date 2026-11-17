import { spawnOwned, spawnOwnedSync } from "./owned.ts";
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { presenceWords } from "@kiwi/core/format.ts";
import { resumedSession } from "../src/daemon/codex-queue.ts";
import { AgentSession } from "../src/agent.ts";
import * as Effect from "effect/Effect";
import { wakeHarness } from "./wake-harness.ts";

setDefaultTimeout(60_000);

const TAKE_MS = 1_500;
const w = wakeHarness({ wakeTakeMs: TAKE_MS });
const { calls, bindAs, until, readAll, seat, quiet, home } = w;

const codex = mkdtempSync("/tmp/kcx-");
const sessions = join(codex, "sessions");
const tmuxSock = join(codex, "tmux.sock");
const tuiBin = join(codex, "tui");
const rpc: string[] = [];
let hooks: Partial<Record<string, () => void | Promise<void>>> = {};
let server: ReturnType<typeof Bun.serve> | undefined;
const prevHome = process.env.CODEX_HOME;
const hasTmux = !!Bun.which("tmux");
const exactArgv = existsSync("/proc/self/cmdline");
const NO_ARGV = "(the exact command line of the Codex in its tmux window can't be read here)";
const REUSED = "01a1e000-0000-7000-8000-000000000011";
const OTHER = "01a1e000-0000-7000-8000-000000000012";

let afterUnread: (() => void) | null = null;
const opened = AgentSession.open.bind(AgentSession);
AgentSession.open = async (...args: Parameters<typeof AgentSession.open>) => {
  const session = await opened(...args);
  const unreadAt = session.unreadAt.bind(session);
  Object.defineProperty(session, "unreadAt", {
    value: (...params: Parameters<typeof session.unreadAt>) =>
      Effect.tap(unreadAt(...params), () =>
        Effect.sync(() => {
          const then = afterUnread;
          afterUnread = null;
          then?.();
        }),
      ),
  });
  return session;
};

const tmux = (...args: string[]) => spawnOwnedSync(["tmux", "-S", tmuxSock, ...args], { stdout: "pipe", stderr: "pipe" });

const thread = (id: string, events: { type: string; at: number }[]): void => {
  const rollout = join(sessions, `rollout-${id}.jsonl`);
  writeFileSync(rollout, events.map((e) => JSON.stringify({ timestamp: new Date(e.at).toISOString(), type: "event_msg", payload: { type: e.type, turn_id: `turn-${e.at}` } })).join("\n") + "\n");
  const db = new Database(join(codex, "state_5.sqlite"));
  try {
    db.run("INSERT OR REPLACE INTO threads (id, rollout_path) VALUES (?, ?)", [id, rollout]);
  } finally {
    db.close();
  }
};

const tui = (args: string): string => `${join(tuiBin, "codex")} ${args}`;

const window = (name: string, command: string): string => {
  tmux("kill-session", "-t", name);
  expect(tmux("new-session", "-d", "-s", name, "-x", "80", "-y", "20", command).exitCode).toBe(0);
  return new TextDecoder().decode(tmux("display", "-p", "-t", name, "#{pane_id}").stdout).trim();
};

const untaken = async () => (await seat())?.untaken ?? null;

beforeAll(() => {
  process.env.CODEX_HOME = codex;
  mkdirSync(sessions, { recursive: true });
  mkdirSync(join(codex, "app-server-control"), { recursive: true });
  mkdirSync(tuiBin, { recursive: true });
  writeFileSync(join(tuiBin, "codex"), "#!/bin/sh\nsleep 600\n");
  chmodSync(join(tuiBin, "codex"), 0o755);
  const db = new Database(join(codex, "state_5.sqlite"));
  db.run("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT)");
  db.close();
  server = Bun.serve({
    unix: join(codex, "app-server-control", "app-server-control.sock"),
    fetch: (req, srv) => (srv.upgrade(req, { data: undefined }) ? undefined : new Response("websocket only", { status: 400 })),
    websocket: {
      async message(ws, raw) {
        const m = JSON.parse(String(raw)) as { id?: number; method: string };
        rpc.push(m.method);
        const hook = hooks[m.method];
        delete hooks[m.method];
        await hook?.();
        if (m.id !== undefined) ws.send(JSON.stringify({ id: m.id, result: {} }));
      },
    },
  });
});

afterAll(() => {
  server?.stop(true);
  if (hasTmux) tmux("kill-server");
  if (prevHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = prevHome;
  rmSync(codex, { recursive: true, force: true });
});

beforeEach(async () => {
  rpc.length = 0;
  hooks = {};
  afterUnread = null;
  await quiet();
  await until("no wake-not-taken alert left from before", async () => (await untaken()) === null, 10_000);
});

const wakeOf = async (body: string): Promise<void> => {
  const before = calls().length;
  await w.ownerCh.send(body, { to: ["claude"] });
  await until("Kiwi's codex queue wake", () => calls().length > before);
};

const status = async (): Promise<string> => {
  const env: Record<string, string | undefined> = { ...process.env, KIWI_HOME: home, KIWI_RELAY: w.relay };
  for (const k of ["CLAUDECODE", "CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "TMUX", "TMUX_PANE"]) delete env[k];
  const p = spawnOwned([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), "-c", "test", "--as", "claude", "status"], { cwd: codex, env, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect(await p.exited, err).toBe(0);
  return out;
};

const wakeRows = (): string[] => (existsSync(join(home, "wake.log")) ? readFileSync(join(home, "wake.log"), "utf8").trim().split("\n") : []);

describe("the session a codex command line resumes", () => {
  test("is the first positional after resume, past options and their values, and nothing else", () => {
    const cases: [string[], string | null][] = [
      [["resume", REUSED], REUSED],
      [["resume", "-a", "never", "--search", REUSED, "a", "prompt"], REUSED],
      [["-c", "model=x", "resume", REUSED], REUSED],
      [["resume", "--model=gpt", "-mgpt", "-C", "/w", REUSED], REUSED],
      [["resume", "--", REUSED], REUSED],
      [["resume", OTHER, REUSED], OTHER],
      [["exec", "resume", REUSED], null],
      [[`resume ${REUSED}`], null],
      [["resume ", REUSED], null],
      [["resume", "--last", REUSED], null],
      [["resume", "-i", "shot.png", REUSED], null],
      [["resume", "--unknown-flag", REUSED], null],
      [["--", "resume", REUSED], null],
      [["resume"], null],
      [[], null],
    ];
    for (const [args, want] of cases) expect([args, resumedSession(args)]).toEqual([args, want]);
  });
});

describe("a Codex wake is checked until the bound session reads it", () => {
  test("an idle seat takes a queued wake, and nothing is flagged or resumed", async () => {
    thread("01a1e000-0000-7000-8000-000000000001", [{ type: "task_complete", at: Date.now() - 60_000 }]);
    bindAs({ harness: "codex", session: "01a1e000-0000-7000-8000-000000000001" });
    await wakeOf("for an idle seat");
    expect(calls().at(-1)).toContain("01a1e000-0000-7000-8000-000000000001");
    await readAll();
    await Bun.sleep(TAKE_MS * 2 + 500);
    expect(await untaken()).toBeNull();
    expect(rpc).toEqual([]);
  });

  test("a seat whose thread changed takes its next wake, and the old thread's check leaves no alert", async () => {
    thread("01a1e000-0000-7000-8000-00000000000a", [{ type: "task_complete", at: Date.now() - 60_000 }]);
    thread("01a1e000-0000-7000-8000-00000000000b", [{ type: "task_complete", at: Date.now() - 30_000 }]);
    bindAs({ harness: "codex", session: "01a1e000-0000-7000-8000-00000000000a" });
    await wakeOf("for the thread before the restart");
    bindAs({ harness: "codex", session: "01a1e000-0000-7000-8000-00000000000b" });
    await wakeOf("for the thread after the restart");
    expect(calls().at(-1)).toContain("01a1e000-0000-7000-8000-00000000000b");
    await Bun.sleep(TAKE_MS + 500);
    await readAll();
    await Bun.sleep(TAKE_MS * 2 + 500);
    expect(await untaken()).toBeNull();
    expect(rpc).toEqual([]);
  });

  test("a wake queued behind a turn that started before it is flagged at its deadline, however busy that turn's rollout is", async () => {
    const id = "01a1e000-0000-7000-8000-000000000010";
    thread(id, [{ type: "task_started", at: Date.now() - 3_600_000 }]);
    const rollout = join(sessions, `rollout-${id}.jsonl`);
    const busy = setInterval(() => appendFileSync(rollout, `${JSON.stringify({ timestamp: new Date().toISOString(), type: "response_item", payload: { type: "message" } })}\n`), 200);
    try {
      bindAs({ harness: "codex", session: id });
      await wakeOf("for a seat stuck in an old turn");
      await until("the wake-not-taken alert", async () => (await untaken()) !== null, TAKE_MS * 4);
      expect((await untaken())?.why).toMatch(new RegExp(`^the wake is queued behind thread ${id}'s turn that started at \\d\\d:\\d\\d UTC, before the wake, and is still running$`));
      await Bun.sleep(TAKE_MS * 2);
      expect(await untaken()).not.toBeNull();
      expect(rpc).toEqual([]);
    } finally {
      clearInterval(busy);
    }
    await readAll();
  });

  test("a wake Codex queued but no turn read shows its reason in kiwi status", async () => {
    thread("01a1e000-0000-7000-8000-00000000000c", [{ type: "task_complete", at: Date.now() - 60_000 }]);
    bindAs({ harness: "codex", session: "01a1e000-0000-7000-8000-00000000000c" });
    await wakeOf("for a session that moved on");
    await until("the wake-not-taken alert", async () => (await untaken()) !== null, TAKE_MS * 4);
    expect((await untaken())?.why).toBe(
      "Codex queued the wake for thread 01a1e000-0000-7000-8000-00000000000c but no turn read it in 2 s: if the session moved to another thread, run a kiwi command there",
    );
    await until("the alert in claude's presence", () => !!w.heard.findLast((p) => p.from === "claude")?.untaken, 10_000);
    expect(presenceWords(w.heard.findLast((p) => p.from === "claude")!)).toContain("wake not taken for ");
    expect(await status()).toMatch(/claude \(you\).* · wake not taken for .*: Codex queued the wake for thread 01a1e000-0000-7000-8000-00000000000c but no turn read it/);
    expect(rpc).toEqual([]);
    await readAll();
  });
});

describe.skipIf(!hasTmux)("a Codex queue paused by an interrupted turn", () => {
  test.if(!exactArgv)("stays paused where a Codex's exact command line can't be read, even in a window started after the abort", async () => {
    thread("01a1e000-0000-7000-8000-00000000000d", [
      { type: "task_started", at: Date.now() - 3_600_000 },
      { type: "turn_aborted", at: Date.now() - 3_590_000 },
    ]);
    const pane = window("restarted", tui("resume 01a1e000-0000-7000-8000-00000000000d -a never"));
    bindAs({ harness: "codex", session: "01a1e000-0000-7000-8000-00000000000d", tmux: { socket: tmuxSock, pane } });
    await wakeOf("for a session restarted where argv can't be read");
    await until("the paused alert", async () => (await untaken()) !== null, TAKE_MS * 4);
    expect((await untaken())?.why).toContain(NO_ARGV);
    await Bun.sleep(TAKE_MS * 2);
    expect(rpc).toEqual([]);
    await readAll();
  });

  test.if(exactArgv)("is resumed when the seat's own window started after the abort, and the woken turn's read clears it", async () => {
    thread("01a1e000-0000-7000-8000-00000000000d", [
      { type: "task_started", at: Date.now() - 3_600_000 },
      { type: "turn_aborted", at: Date.now() - 3_590_000 },
    ]);
    const pane = window("restarted", tui("resume 01a1e000-0000-7000-8000-00000000000d -a never"));
    bindAs({ harness: "codex", session: "01a1e000-0000-7000-8000-00000000000d", tmux: { socket: tmuxSock, pane } });
    hooks["thread/queue/start"] = () => void readAll();
    await wakeOf("for a session restarted after a shutdown");
    await until("Kiwi resuming the paused queue", () => rpc.includes("thread/queue/start"), TAKE_MS * 4);
    expect(rpc).toEqual(["initialize", "initialized", "thread/resume", "thread/queue/start"]);
    await until("the resume's row in wake.log", () => /resumed Codex/.test(wakeRows().at(-1) ?? ""));
    expect(wakeRows().at(-1)).toMatch(/\tcodex-queue\t\d+\tok\tresumed Codex's paused queue: the session restarted at \d\d:\d\d UTC, after its turn was interrupted at \d\d:\d\d UTC\t/);
    await Bun.sleep(TAKE_MS * 2 + 500);
    expect(await untaken()).toBeNull();
    expect(rpc.filter((m) => m === "thread/queue/start")).toHaveLength(1);
  });

  const races = [
    ["initialize", "the binding moves to another thread", ["initialize", "initialized"]],
    ["thread/resume", "the binding moves to another thread", ["initialize", "initialized", "thread/resume"]],
    ["initialize", "the thread's turn is interrupted again", ["initialize", "initialized"]],
    ["thread/resume", "the thread's turn is interrupted again", ["initialize", "initialized", "thread/resume"]],
    ["initialize", "the seat reads the wake", ["initialize", "initialized"]],
    ["thread/resume", "the seat reads the wake", ["initialize", "initialized", "thread/resume"]],
  ] as const;
  for (const [i, [stage, what, sent]] of races.entries())
    test.if(exactArgv)(`never starts the queue when ${what} while Kiwi waits on ${stage}`, async () => {
      const id = `01a1e000-0000-7000-8000-0000000000${20 + i * 2}`;
      const other = `01a1e000-0000-7000-8000-0000000000${21 + i * 2}`;
      thread(id, [
        { type: "task_started", at: Date.now() - 3_600_000 },
        { type: "turn_aborted", at: Date.now() - 3_590_000 },
      ]);
      thread(other, [{ type: "task_complete", at: Date.now() - 60_000 }]);
      const pane = window("race", tui(`resume ${id}`));
      bindAs({ harness: "codex", session: id, tmux: { socket: tmuxSock, pane } });
      const resumes = wakeRows().filter((r) => r.includes("resumed Codex")).length;
      hooks[stage] = async () => {
        if (what === "the binding moves to another thread") bindAs({ harness: "codex", session: other, tmux: { socket: tmuxSock, pane } });
        else if (what === "the seat reads the wake") await readAll();
        else
          thread(id, [
            { type: "task_started", at: Date.now() - 2_000 },
            { type: "turn_aborted", at: Date.now() },
          ]);
      };
      await wakeOf(`for a restarted session, while ${what} during ${stage}`);
      await until(`Kiwi reaching ${stage}`, () => rpc.includes(stage), TAKE_MS * 4);
      await Bun.sleep(TAKE_MS * 2 + 500);
      expect(rpc).toEqual([...sent]);
      expect(wakeRows().filter((r) => r.includes("resumed Codex")).length).toBe(resumes);
      if (what !== "the thread's turn is interrupted again") expect(await untaken()).toBeNull();
      await readAll();
    });

  for (const [i, [stage, sent]] of (
    [
      ["initialize", ["initialize", "initialized"]],
      ["thread/resume", ["initialize", "initialized", "thread/resume"]],
    ] as const
  ).entries())
    test.if(exactArgv)(`never starts the queue when the binding moves while the check after ${stage} looks up the unread wake`, async () => {
      const id = `01a1e000-0000-7000-8000-0000000000${40 + i * 2}`;
      const other = `01a1e000-0000-7000-8000-0000000000${41 + i * 2}`;
      thread(id, [
        { type: "task_started", at: Date.now() - 3_600_000 },
        { type: "turn_aborted", at: Date.now() - 3_590_000 },
      ]);
      thread(other, [{ type: "task_complete", at: Date.now() - 60_000 }]);
      const pane = window("guard", tui(`resume ${id}`));
      bindAs({ harness: "codex", session: id, tmux: { socket: tmuxSock, pane } });
      hooks[stage] = () => {
        afterUnread = () => bindAs({ harness: "codex", session: other, tmux: { socket: tmuxSock, pane } });
      };
      await wakeOf(`for a restarted session whose binding moves during the check after ${stage}`);
      await until(`Kiwi reaching ${stage}`, () => rpc.includes(stage), TAKE_MS * 4);
      await until("the binding move", () => afterUnread === null, TAKE_MS * 4);
      await Bun.sleep(TAKE_MS * 2 + 500);
      expect(rpc).toEqual([...sent]);
      expect(await untaken()).toBeNull();
      await readAll();
    });

  test.if(exactArgv)("stays paused when the turn was interrupted in the running session, and says it was paused by you", async () => {
    const pane = window("live", `${tui("resume 01a1e000-0000-7000-8000-00000000000e")} & sleep 2.5; ${tui("exec an-unrelated-task")} & wait`);
    await Bun.sleep(1_100);
    thread("01a1e000-0000-7000-8000-00000000000e", [
      { type: "task_started", at: Date.now() - 2_000 },
      { type: "turn_aborted", at: Date.now() },
    ]);
    bindAs({ harness: "codex", session: "01a1e000-0000-7000-8000-00000000000e", tmux: { socket: tmuxSock, pane } });
    await Bun.sleep(2_000);
    await wakeOf("for a session its person stopped, while a newer unrelated Codex runs in its window");
    await until("the paused alert", async () => (await untaken()) !== null, TAKE_MS * 4);
    expect((await untaken())?.why).toStartWith("paused by you: the turn was interrupted at ");
    await Bun.sleep(TAKE_MS * 2);
    expect(rpc).toEqual([]);
    await readAll();
  });

  for (const [what, command] of [
    ["another thread's session reused its window", tui(`resume ${OTHER}`)],
    ["another thread was resumed with this thread's id as its prompt", tui(`resume ${OTHER} ${REUSED}`)],
    ["a codex exec whose prompt holds resume and this thread's id started", tui(`exec resume ${REUSED}`)],
    ["a codex whose quoted prompt is resume and this thread's id started", `${join(tuiBin, "codex")} 'resume ${REUSED}'`],
    ["a codex resume with images listed before this thread's id started", tui(`resume -i shot.png ${REUSED}`)],
    ["a plain codex session, which names no thread, started in its window", tui("-a never")],
    ["an unrelated Codex child process started", `sh -c "${tui("exec an-unrelated-task")}"`],
  ] as const)
    test(`stays paused when ${what} after the abort, since that isn't this thread's session`, async () => {
      const id = REUSED;
      thread(id, [
        { type: "task_started", at: Date.now() - 3_600_000 },
        { type: "turn_aborted", at: Date.now() - 3_590_000 },
      ]);
      const pane = window("reused", command);
      bindAs({ harness: "codex", session: id, tmux: { socket: tmuxSock, pane } });
      await wakeOf(`for a paused thread whose window now runs something else: ${what}`);
      await until("the paused alert", async () => (await untaken()) !== null, TAKE_MS * 4);
      expect((await untaken())?.why).toContain(exactArgv ? "(no Codex in its tmux window was started as codex resume of this thread)" : NO_ARGV);
      await Bun.sleep(TAKE_MS * 2);
      expect(rpc).toEqual([]);
      await readAll();
    });

  test("stays paused when Kiwi can't tell whether the session restarted, and says why", async () => {
    thread("01a1e000-0000-7000-8000-00000000000f", [
      { type: "task_started", at: Date.now() - 3_600_000 },
      { type: "turn_aborted", at: Date.now() - 3_590_000 },
    ]);
    bindAs({ harness: "codex", session: "01a1e000-0000-7000-8000-00000000000f" });
    await wakeOf("for a session Kiwi has no window for");
    await until("the paused alert", async () => (await untaken()) !== null, TAKE_MS * 4);
    expect((await untaken())?.why).toMatch(
      /^paused: Codex holds thread 01a1e000-0000-7000-8000-00000000000f's queue since its turn was interrupted at \d\d:\d\d UTC, and Kiwi can't tell if the session restarted since \(Kiwi doesn't know which window runs this Codex session\); type in its window to continue$/,
    );
    await Bun.sleep(TAKE_MS * 2);
    expect(rpc).toEqual([]);
    await readAll();
  });
});
