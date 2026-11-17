import { spawnOwned, spawnOwnedSync } from "./owned.ts";
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { presenceWords } from "@kiwi/core/format.ts";
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
let onStart: () => void = () => {};
let server: ReturnType<typeof Bun.serve> | undefined;
const prevHome = process.env.CODEX_HOME;
const hasTmux = !!Bun.which("tmux");

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

const window = (name: string): string => {
  tmux("kill-session", "-t", name);
  expect(tmux("new-session", "-d", "-s", name, "-x", "80", "-y", "20", `${join(tuiBin, "codex")}`).exitCode).toBe(0);
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
      message(ws, raw) {
        const m = JSON.parse(String(raw)) as { id?: number; method: string };
        rpc.push(m.method);
        if (m.method === "thread/queue/start") onStart();
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
  onStart = () => {};
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
  test("is resumed when the seat's own window started after the abort, and the woken turn's read clears it", async () => {
    thread("01a1e000-0000-7000-8000-00000000000d", [
      { type: "task_started", at: Date.now() - 3_600_000 },
      { type: "turn_aborted", at: Date.now() - 3_590_000 },
    ]);
    const pane = window("restarted");
    bindAs({ harness: "codex", session: "01a1e000-0000-7000-8000-00000000000d", tmux: { socket: tmuxSock, pane } });
    onStart = () => void readAll();
    await wakeOf("for a session restarted after a shutdown");
    await until("Kiwi resuming the paused queue", () => rpc.includes("thread/queue/start"), TAKE_MS * 4);
    expect(rpc).toEqual(["initialize", "initialized", "thread/resume", "thread/queue/start"]);
    await until("the resume's row in wake.log", () => /resumed Codex/.test(wakeRows().at(-1) ?? ""));
    expect(wakeRows().at(-1)).toMatch(/\tcodex-queue\t\d+\tok\tresumed Codex's paused queue: the session restarted at \d\d:\d\d UTC, after its turn was interrupted at \d\d:\d\d UTC\t/);
    await Bun.sleep(TAKE_MS * 2 + 500);
    expect(await untaken()).toBeNull();
    expect(rpc.filter((m) => m === "thread/queue/start")).toHaveLength(1);
  });

  test("stays paused when the turn was interrupted in the running session, and says it was paused by you", async () => {
    const pane = window("live");
    await Bun.sleep(1_100);
    thread("01a1e000-0000-7000-8000-00000000000e", [
      { type: "task_started", at: Date.now() - 2_000 },
      { type: "turn_aborted", at: Date.now() },
    ]);
    bindAs({ harness: "codex", session: "01a1e000-0000-7000-8000-00000000000e", tmux: { socket: tmuxSock, pane } });
    await wakeOf("for a session its person stopped");
    await until("the paused alert", async () => (await untaken()) !== null, TAKE_MS * 4);
    expect((await untaken())?.why).toStartWith("paused by you: the turn was interrupted at ");
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
