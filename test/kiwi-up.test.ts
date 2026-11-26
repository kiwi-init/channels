import { spawnOwned } from "./owned.ts";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { wakePath } from "@kiwi/core/wake.ts";
import { loadConfig, updateConfig, type Config, type SeatRecord } from "../src/config.ts";
import { abandonReserved, adoptReserved, bindHeldSeat, holdSeat, reserveSeat, SEAT_TOKEN, UP_LAUNCH, type Liveness } from "../src/hold.ts";
import { claudeArgv, claudeTranscript } from "../src/loop/claude.ts";
import { processStart } from "../src/pid.ts";
import { seatsFor } from "../src/seats.ts";
import { onlyArgs, readUpChoices, readUpOutcomes, readUpPicks } from "@kiwi/core/up-outcome.ts";
import { outcomeJson, outcomeLine, upAll } from "../src/up/all.ts";
import { printedLine, seatArgv, tmuxLauncher, type Launcher } from "../src/up/launch.ts";
import { sessionLiveness, type Probe } from "../src/up/liveness.ts";
import { NO_SAMPLE, planJson, planUp, runningAtShutdown, usedSince, withMembers, type SeatPlan } from "../src/up/plan.ts";
import { pickSeats, readersFor, readSelection } from "../src/up/select.ts";
import { beforeThisBoot, nextRunning, noteRunning, readRunning } from "../src/up/running.ts";
import { FRESH_PROMPT, RESUMED_PROMPT, restoreSeat, type RestoreDeps } from "../src/up/restore.ts";
import type { Report } from "../src/up/ready.ts";

let home = "";
let dir = "";
const prev = { home: process.env.KIWI_HOME, token: process.env[SEAT_TOKEN], up: process.env[UP_LAUNCH] };
const children: Bun.Subprocess[] = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kiwi-up-"));
  dir = join(home, "proj");
  mkdirSync(dir);
  process.env.KIWI_HOME = home;
  delete process.env[SEAT_TOKEN];
  delete process.env[UP_LAUNCH];
  updateConfig((c) => {
    c.channels.ch = { roomId: "room", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "http://127.0.0.1:1", code: "mc2-x" };
  });
});

afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  for (const [key, value] of [
    ["KIWI_HOME", prev.home],
    [SEAT_TOKEN, prev.token],
    [UP_LAUNCH, prev.up],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
});

const DEAD_PID = 2_000_000_000;

const seats = (): SeatRecord[] => Object.values(loadConfig().bindings ?? {}).flatMap((v) => (Array.isArray(v) ? v : [v]));
const seatOf = (as: string): SeatRecord | undefined => seats().find((b) => b.as === as);

function place(at: string, ...records: SeatRecord[]): void {
  updateConfig((c) => {
    const [only, ...more] = records;
    c.bindings = { ...c.bindings, [at]: only && !more.length ? only : records };
  });
}

const deadClaude = (as: string, session = `${as}-old`): SeatRecord => ({ alias: "ch", as, harness: "claude", session, pid: DEAD_PID, at: 1, seen: 1 });

const testLive = (b: SeatRecord): Liveness => (b.pid && b.started && processStart(b.pid) === b.started ? { kind: "alive" } : { kind: "dead" });

interface Fake {
  deps: RestoreDeps;
  spawned: { argv: string[]; cwd: string; env: Record<string, string>; pid: number }[];
  stopped: number[];
  bindAfter: { polls: number };
  transcripts: Set<string>;
  wakeWhy: { value: string | null };
  hooked: { value: boolean };
}

function fake(): Fake {
  const spawned: Fake["spawned"] = [];
  const stopped: number[] = [];
  const bindAfter = { polls: 2 };
  const transcripts = new Set<string>();
  const wakeWhy: { value: string | null } = { value: null };
  const hooked = { value: true };
  const bound = new Map<string, string>();
  let clock = Date.now();
  const polls = new Map<number, number>();
  const sessions = new Map<number, string>();
  const deps: RestoreDeps = {
    shell: "/bin/sh",
    bin: "claude",
    spawn: (argv, cwd, env) => {
      const child = spawnOwned(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
      children.push(child);
      spawned.push({ argv, cwd, env, pid: child.pid });
      const resumed = argv[argv.indexOf("--resume") + 1];
      sessions.set(child.pid, argv.includes("--resume") && resumed ? resumed : `fresh-${child.pid}`);
      return { pid: child.pid, exited: child.exited };
    },
    started: (pid) => {
      const n = (polls.get(pid) ?? 0) + 1;
      polls.set(pid, n);
      const session = n > bindAfter.polls ? (sessions.get(pid) ?? null) : null;
      const env = spawned.find((r) => r.pid === pid)?.env;
      if (session && env?.[SEAT_TOKEN]) bound.set(env[SEAT_TOKEN], session);
      return session;
    },
    seen: (token) => (hooked.value ? (bound.get(token) ?? null) : null),
    forget: (token) => void bound.delete(token),
    transcript: (session) => transcripts.has(session),
    stop: async (pid) => {
      stopped.push(pid);
      const child = children.find((c) => c.pid === pid);
      child?.kill("SIGKILL");
      await child?.exited;
    },
    wake: async () => wakeWhy.value,
    live: testLive,
    sleep: async (ms) => {
      clock += ms;
      await new Promise((r) => setTimeout(r, 1));
    },
    now: () => clock,
    aborted: () => false,
  };
  return { deps, spawned, stopped, bindAfter, transcripts, wakeWhy, hooked };
}

const hookView = (who: string, env: Record<string, string>, pid?: number) => seatsFor(dir, { who: { harness: "claude", session: who, ...(pid ? { pid } : {}) }, env, claim: false }).map((b) => b.as);

test("a seat whose transcript is still there resumes that session, bound to the new process with its launch's key", async () => {
  place(dir, deadClaude("dev"));
  const f = fake();
  f.transcripts.add("dev-old");
  const r = await restoreSeat("ch", "dev", 5_000, f.deps, {});
  expect(r).toMatchObject({ kind: "restored", session: "dev-old", resumed: true, dir });
  const [run] = f.spawned;
  expect(run?.argv.slice(-5)).toEqual(["claude", "--resume", "dev-old", "--", RESUMED_PROMPT]);
  expect(run?.argv).toContain("KIWI_AS=dev");
  expect(run?.argv).toContain("KIWI_CHANNEL=ch");
  expect(run?.cwd).toBe(dir);
  expect(run?.env[UP_LAUNCH]).toBe("1");
  const seat = seatOf("dev");
  expect(seat).toMatchObject({ alias: "ch", as: "dev", harness: "claude", session: "dev-old", pid: run?.pid, started: processStart(run?.pid ?? 0) ?? "" });
  expect(seat?.upKey).toEqual(expect.any(String));
  expect(seat?.hold).toBeUndefined();
});

test("with the transcript gone, a fresh session takes the same seat: same handle, wake by hooks, found by its hooks, no new seat", async () => {
  place(dir, deadClaude("dev"));
  const f = fake();
  const before = seats().length;
  const r = await restoreSeat("ch", "dev", 5_000, f.deps, {});
  if (r.kind !== "restored") throw new Error(`not restored: ${JSON.stringify(r)}`);
  expect(r.resumed).toBe(false);
  const run = f.spawned[0];
  if (!run) throw new Error("nothing spawned");
  expect(run.argv).not.toContain("--resume");
  expect(run.argv.at(-1)).toBe(FRESH_PROMPT);
  expect(seats().length).toBe(before);
  const seat = seatOf("dev");
  expect(seat).toMatchObject({ alias: "ch", as: "dev", session: r.session, pid: run.pid });
  expect(wakePath(seat ?? null, true)).toEqual({ kind: "hooks" });
  expect(hookView(r.session, run.env, run.pid)).toEqual(["dev"]);
});

test("three Claude seats in one folder each come back as themselves, and a held seat's child never takes a neighbour", async () => {
  place(dir, deadClaude("a"), deadClaude("b"), deadClaude("c"));
  const token = "token-a";
  expect(reserveSeat("ch", "a", token, testLive).kind).toBe("held");
  expect(hookView("new-a", { [SEAT_TOKEN]: token, [UP_LAUNCH]: "1" })).toEqual(["a"]);
  updateConfig((c) => {
    c.bindings = { [dir]: [deadClaude("a"), deadClaude("b"), deadClaude("c")] };
  });
  const f = fake();
  const results = [];
  for (const as of ["a", "b", "c"]) results.push(await restoreSeat("ch", as, 5_000, f.deps, {}));
  expect(results.map((r) => r.kind)).toEqual(["restored", "restored", "restored"]);
  for (const [i, as] of ["a", "b", "c"].entries()) {
    const run = f.spawned[i];
    if (!run) throw new Error(`no run for ${as}`);
    expect(seatOf(as)).toMatchObject({ session: `fresh-${run.pid}`, pid: run.pid });
    expect(hookView(`fresh-${run.pid}`, run.env, run.pid)).toEqual([as]);
  }
});

test("a second run in the same process, while the first waits for its session, starts nothing", async () => {
  place(dir, deadClaude("dev"));
  const f = fake();
  f.bindAfter.polls = 5;
  const [first, second] = await Promise.all([restoreSeat("ch", "dev", 5_000, f.deps, {}), restoreSeat("ch", "dev", 5_000, f.deps, {})]);
  expect([first.kind, second.kind].sort()).toEqual(["restored", "running"]);
  expect(f.spawned.length).toBe(1);
});

test("a run after the window opened but before the agent bound starts nothing, and a later run finds the session running", async () => {
  place(dir, deadClaude("dev"));
  const f = fake();
  f.bindAfter.polls = 10;
  const first = restoreSeat("ch", "dev", 5_000, f.deps, {});
  await new Promise((r) => setTimeout(r, 1));
  expect(seatOf("dev")?.hold?.up).toBe(true);
  expect(await restoreSeat("ch", "dev", 5_000, f.deps, {})).toEqual({ kind: "running", why: "another kiwi up is starting it" });
  expect((await first).kind).toBe("restored");
  expect(await restoreSeat("ch", "dev", 5_000, f.deps, {})).toEqual({ kind: "running", why: "its session is still running" });
  expect(f.spawned.length).toBe(1);
});

test("two processes reserving one seat at once: exactly one holds it", async () => {
  place(dir, deadClaude("dev"));
  const script = join(home, "reserve.ts");
  const hold = resolve(import.meta.dir, "../src/hold.ts");
  writeFileSync(
    script,
    `import { reserveSeat } from ${JSON.stringify(hold)};\nconst r = reserveSeat("ch", "dev", "t-" + process.pid, () => ({ kind: "dead" }));\nawait Bun.sleep(300);\nconsole.log(r.kind);\n`,
  );
  const run = () => spawnOwned([process.execPath, script], { env: { ...process.env, KIWI_HOME: home }, stdout: "pipe", stderr: "pipe" });
  const [a, b] = [run(), run()];
  const outs = await Promise.all([a, b].map(async (p) => (await new Response(p.stdout).text()).trim()));
  expect(outs.sort()).toEqual(["held", "starting"]);
});

test("a start that never binds is stopped, leaves the record as it was, and the next run brings the seat back", async () => {
  place(dir, deadClaude("dev"));
  const before = seatOf("dev");
  const f = fake();
  f.bindAfter.polls = Number.MAX_SAFE_INTEGER;
  const r = await restoreSeat("ch", "dev", 50, f.deps, {});
  expect(r).toEqual({ kind: "failed", why: "Claude Code didn't start a session within 0s" });
  expect(f.stopped).toEqual([f.spawned[0]?.pid ?? -1]);
  expect({ ...seatOf("dev"), holds: undefined }).toEqual({ ...before, holds: undefined });
  f.bindAfter.polls = 1;
  expect((await restoreSeat("ch", "dev", 5_000, f.deps, {})).kind).toBe("restored");
});

test("after a timed-out launch, its late hooks get no seat: a fresh child, and a resumed child under the seat's own session id", async () => {
  place(dir, deadClaude("dev"));
  const f = fake();
  f.bindAfter.polls = Number.MAX_SAFE_INTEGER;
  f.transcripts.add("dev-old");
  await restoreSeat("ch", "dev", 50, f.deps, {});
  const late = f.spawned[0];
  if (!late) throw new Error("nothing spawned");
  expect(hookView("dev-old", late.env)).toEqual([]);
  expect(hookView("brand-new", late.env)).toEqual([]);
  expect(seatOf("dev")?.session).toBe("dev-old");
  f.bindAfter.polls = 1;
  const ok = await restoreSeat("ch", "dev", 5_000, f.deps, {});
  const good = f.spawned[1];
  if (ok.kind !== "restored" || !good) throw new Error("second run didn't restore");
  expect(hookView("dev-old", good.env, good.pid)).toEqual(["dev"]);
  expect(hookView("dev-old", late.env)).toEqual([]);
});

test("a session that binds but can't be woken is stopped and the seat goes back to its record before the run", async () => {
  place(dir, deadClaude("dev"));
  const before = seatOf("dev");
  const f = fake();
  f.wakeWhy.value = "Claude Code's listening hooks aren't installed";
  const r = await restoreSeat("ch", "dev", 5_000, f.deps, {});
  expect(r).toEqual({ kind: "failed", why: "the new session can't be woken: Claude Code's listening hooks aren't installed" });
  expect(f.stopped.length).toBe(1);
  expect({ ...seatOf("dev"), holds: undefined }).toEqual({ ...before, holds: undefined });
  expect(seatOf("dev")?.upKey).toBeUndefined();
});

test("a hold left by a kiwi up that died is stale: the next run takes the seat over", async () => {
  place(dir, { ...deadClaude("dev"), hold: { key: "gone", at: 1, holder: { pid: DEAD_PID, started: "x" }, up: true } });
  const f = fake();
  expect((await restoreSeat("ch", "dev", 5_000, f.deps, {})).kind).toBe("restored");
  expect(seatOf("dev")?.hold).toBeUndefined();
});

test("seats kiwi up can't start are reported by name, never started", async () => {
  place(dir, { alias: "ch", as: "rev", harness: "codex", session: "t", at: 1 }, { alias: "ch", as: "me", plain: true, at: 1 });
  const plans = planUp(loadConfig(), testLive);
  expect(plans.map((p) => [p.as, p.kind])).toEqual([
    ["rev", "unsupported"],
    ["me", "unsupported"],
  ]);
  const [rev] = plans;
  if (!rev) throw new Error("no plan for rev");
  expect(outcomeLine({ plan: rev, result: "skipped", why: "x" })).toContain("rev in ch");
  const f = fake();
  expect(await restoreSeat("ch", "rev", 5_000, f.deps, {})).toEqual({ kind: "failed", why: "kiwi up doesn't restore codex seats yet: start it yourself in its folder" });
  expect(f.spawned).toEqual([]);
});

test("loop seats restart their loop, a stale loop hold included; a live loop is left alone", () => {
  place(
    dir,
    { alias: "ch", as: "looped", harness: "codex", session: "t", pid: DEAD_PID, loop: true, at: 1 },
    { alias: "ch", as: "between", harness: "claude", hold: { key: "k", at: 1, holder: { pid: DEAD_PID, started: "x" } }, at: 1 },
    { alias: "ch", as: "live", harness: "claude", hold: { key: "k", at: 1, holder: { pid: process.pid, started: processStart(process.pid) ?? "" } }, at: 1 },
  );
  expect(planUp(loadConfig(), testLive).map((p) => [p.as, p.kind])).toEqual([
    ["looped", "loop"],
    ["between", "loop"],
    ["live", "running"],
  ]);
});

test("with no launcher, kiwi up prints one quoted line per seat and changes nothing", async () => {
  const odd = join(home, "it's here");
  mkdirSync(odd);
  place(odd, deadClaude("dev"), { alias: "ch", as: "lp", harness: "codex", loop: true, at: 1 });
  updateConfig((c) => {
    c.channels["my ch"] = { roomId: "r2", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "http://127.0.0.1:1", code: "mc2-y" };
    c.bindings = { ...c.bindings, [dir]: { ...deadClaude("x;y"), alias: "my ch" } };
  });
  const before = JSON.stringify(loadConfig());
  const plans = planUp(loadConfig(), testLive);
  const outcomes = await upAll(plans, null, ["kiwi"], 60, 1_000, {
    load: loadConfig,
    sleep: async () => {},
    now: () => Date.now(),
    newId: () => "0".repeat(16),
    report: () => null,
    forget: () => {},
    token: () => "t",
    keyOf: (t: string) => t,
    reserve: () => ({ kind: "held" as const, prior: [] }),
    abandon: () => {},
  });
  expect(outcomes.map(outcomeLine)).toEqual(["kiwi up --seat dev -c ch", `cd '${odd.replace("'", "'\\''")}' && kiwi loop --harness codex -c ch --as lp`, "kiwi up --seat 'x;y' -c 'my ch'"]);
  expect(JSON.stringify(loadConfig())).toBe(before);
  expect(plans.flatMap((p) => (p.kind === "restore" || p.kind === "loop" ? [printedLine(p)] : []))).toEqual(outcomes.map(outcomeLine));
});

test("kiwi up opens one window per seat and reports each as restored once its session takes the seat, or failed when none does", async () => {
  place(dir, deadClaude("ok"), deadClaude("stuck"));
  const opened: string[][] = [];
  const launcher: Launcher = {
    name: "tmux",
    open: (at, argv) => {
      opened.push([at.as, at.dir, ...argv]);
      return null;
    },
  };
  let ticks = 0;
  let ids = 0;
  const forgotten: string[] = [];
  const deps = {
    load: loadConfig,
    now: () => Date.now() + ticks * 1_000,
    sleep: async () => void ticks++,
    newId: () => String(++ids).padStart(16, "0"),
    report: (id: string): Report | null => (id === "0000000000000001" && ticks >= 1 ? { result: "restored", why: "it resumed its session" } : null),
    forget: (id: string) => void forgotten.push(id),
    token: () => "t",
    keyOf: (t: string) => t,
    reserve: () => ({ kind: "held" as const, prior: [] }),
    abandon: () => {},
  };
  const outcomes = await upAll(planUp(loadConfig(), testLive), launcher, ["/bin/kiwi"], 300, 10_000, deps);
  expect(opened).toEqual([
    ["ok", dir, "/bin/kiwi", "up", "--seat", "ok", "-c", "ch", "--bind-timeout", "300", "--report", "0000000000000001"],
    ["stuck", dir, "/bin/kiwi", "up", "--seat", "stuck", "-c", "ch", "--bind-timeout", "300", "--report", "0000000000000002"],
  ]);
  expect(forgotten).toEqual(["0000000000000001", "0000000000000002"]);
  expect(outcomes.map((o) => [o.plan.as, o.result])).toEqual([
    ["ok", "restored"],
    ["stuck", "failed"],
  ]);
});

test("the tmux launcher starts a detached kiwi session, adds windows to it after, and uses the current session inside tmux", () => {
  const calls: string[][] = [];
  let has = 1;
  const run = (argv: readonly string[]) => {
    calls.push([...argv]);
    return { status: argv[1] === "has-session" ? has : 0, stdout: "@7\n", stderr: "" };
  };
  const at = { alias: "ch", as: "dev", dir: "/w" };
  expect(tmuxLauncher("tmux", {}, run).open(at, ["kiwi", "up"])).toBeNull();
  has = 0;
  tmuxLauncher("tmux", {}, run).open(at, ["kiwi", "up"]);
  tmuxLauncher("tmux", { TMUX: "/tmp/s,1,0" }, run).open(at, ["kiwi", "up"]);
  expect(calls.filter((c) => c[1] !== "has-session" && c[1] !== "set-option")).toEqual([
    ["tmux", "new-session", "-d", "-s", "kiwi", "-P", "-F", "#{window_id}", "-c", "/w", "-n", "dev", "kiwi", "up"],
    ["tmux", "new-window", "-d", "-t", "=kiwi:", "-P", "-F", "#{window_id}", "-c", "/w", "-n", "dev", "kiwi", "up"],
    ["tmux", "new-window", "-d", "-P", "-F", "#{window_id}", "-c", "/w", "-n", "dev", "kiwi", "up"],
  ]);
  expect(calls).toContainEqual(["tmux", "set-option", "-w", "-t", "@7", "remain-on-exit", "failed"]);
});

test("liveness: a recorded start must match; without one, a session from before this boot is gone; other platforms say unsupported", () => {
  const probe = (over: Partial<Probe> = {}): Probe => ({ platform: "linux", alive: () => true, start: () => "boot:1", boot: () => 1_000, ...over });
  const seat = (over: Partial<SeatRecord>): SeatRecord => ({ alias: "ch", as: "x", harness: "claude", session: "s", pid: 42, ...over });
  expect(sessionLiveness(seat({ started: "boot:1" }), probe())).toEqual({ kind: "alive" });
  expect(sessionLiveness(seat({ started: "boot:0" }), probe())).toEqual({ kind: "dead" });
  expect(sessionLiveness(seat({ at: 500 }), probe())).toEqual({ kind: "dead" });
  expect(sessionLiveness(seat({ at: 2_000 }), probe())).toEqual({ kind: "alive" });
  expect(sessionLiveness(seat({ at: 2_000 }), probe({ alive: () => false }))).toEqual({ kind: "dead" });
  expect(sessionLiveness(seat({ at: 2_000 }), probe({ boot: () => null })).kind).toBe("unknown");
  expect(sessionLiveness(seat({ at: 2_000, started: "boot:1" }), probe({ platform: "win32" }))).toEqual({ kind: "unknown", why: "kiwi up can't tell whether a session still runs on win32" });
  expect(sessionLiveness(seat({ pid: undefined, at: 2_000 }), probe()).kind).toBe("unknown");
  expect(sessionLiveness(seat({ pid: undefined, session: undefined }), probe())).toEqual({ kind: "dead" });
});

test("Claude's resume argv and transcript lookup", () => {
  expect(claudeArgv({ bin: "claude", resume: "abc", model: "m", prompt: "p" })).toEqual(["claude", "--resume", "abc", "--model", "m", "--", "p"]);
  const claudeHome = join(home, "claude");
  mkdirSync(join(claudeHome, "projects", "-w"), { recursive: true });
  writeFileSync(join(claudeHome, "projects", "-w", "abc.jsonl"), "");
  expect(claudeTranscript("abc", { CLAUDE_CONFIG_DIR: claudeHome })).toBe(true);
  expect(claudeTranscript("nope", { CLAUDE_CONFIG_DIR: claudeHome })).toBe(false);
  expect(claudeTranscript("../abc", { CLAUDE_CONFIG_DIR: claudeHome })).toBe(false);
});

const seat = (as: string) => ({ alias: "ch", as });

test("the running sample drops a seat only after two missed samples, so agents dying a little before the daemon still come back", () => {
  let file = nextRunning(null, "boot-1", [seat("a"), seat("b")], 1);
  file = nextRunning(file, "boot-1", [], 2);
  expect(file.seats).toEqual([seat("a"), seat("b")]);
  const rebooted = nextRunning(file, "boot-2", [], 3);
  expect(beforeThisBoot(rebooted, "boot-2")?.seats).toEqual([seat("a"), seat("b")]);
  expect(rebooted.seats).toEqual([]);
});

test("a seat stopped on purpose drops out after two samples and stays down after the restart; a stalled shutdown loses them all, as documented", () => {
  let file = nextRunning(null, "boot-1", [seat("a"), seat("b")], 1);
  file = nextRunning(file, "boot-1", [seat("a")], 2);
  file = nextRunning(file, "boot-1", [seat("a")], 3);
  expect(beforeThisBoot(nextRunning(file, "boot-2", [], 4), "boot-2")?.seats).toEqual([seat("a")]);
  file = nextRunning(file, "boot-1", [], 5);
  file = nextRunning(file, "boot-1", [], 6);
  expect(beforeThisBoot(nextRunning(file, "boot-2", [], 7), "boot-2")?.seats).toEqual([]);
});

test("kiwi up reads what ran before this boot whether or not the daemon has rotated the file yet", () => {
  noteRunning(home, "boot-1", [seat("a")]);
  expect(beforeThisBoot(readRunning(home), "boot-2")?.seats).toEqual([seat("a")]);
  noteRunning(home, "boot-2", [seat("b")]);
  expect(beforeThisBoot(readRunning(home), "boot-2")?.seats).toEqual([seat("a")]);
  expect(readRunning(home)?.seats).toEqual([seat("b")]);
});

test("only seats running at shutdown start; with no sample (first run after the upgrade) nothing starts and each seat gets its line", () => {
  place(dir, deadClaude("ran"), deadClaude("stopped"));
  const plans = planUp(loadConfig(), testLive, runningAtShutdown([seat("ran")]));
  expect(plans.map((p) => [p.as, p.kind])).toEqual([
    ["ran", "restore"],
    ["stopped", "idle"],
  ]);
  const none = planUp(loadConfig(), testLive, runningAtShutdown(null));
  expect(none.map((p) => (p.kind === "idle" ? [p.as, p.why, printedLine(p.start)] : [p.as, p.kind]))).toEqual([
    ["ran", NO_SAMPLE, "kiwi up --seat ran -c ch"],
    ["stopped", NO_SAMPLE, "kiwi up --seat stopped -c ch"],
  ]);
});

test("--since picks seats by their last use, and only current members of a channel ever start", () => {
  place(dir, { ...deadClaude("recent"), at: 5_000 }, { ...deadClaude("old"), at: 1_000 }, deadClaude("left"), deadClaude("unread"));
  const plans = planUp(
    loadConfig(),
    testLive,
    usedSince(4_000, (b) => b.at ?? 0),
  );
  expect(plans.map((p) => [p.as, p.kind])).toEqual([
    ["recent", "restore"],
    ["old", "idle"],
    ["left", "idle"],
    ["unread", "idle"],
  ]);
  const members = withMembers(planUp(loadConfig(), testLive), (_alias, as) => (as === "left" ? { kind: "left" } : as === "unread" ? { kind: "unverified", why: "relay down" } : { kind: "member" }));
  expect(members.map((p) => [p.as, p.kind, "why" in p ? p.why : ""])).toEqual([
    ["recent", "restore", ""],
    ["old", "restore", ""],
    ["left", "skipped", "it left the channel or was removed"],
    ["unread", "skipped", "its membership couldn't be checked: relay down"],
  ]);
});

test("two kiwi up runs on a dead loop: the second, planned before the first loop bound, finds its live session and starts nothing", async () => {
  place(dir, { alias: "ch", as: "lp", harness: "claude", session: "gone", pid: DEAD_PID, loop: true, at: 1 });
  const plansA = planUp(loadConfig(), testLive);
  const plansB = planUp(loadConfig(), testLive);
  const child = spawnOwned(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
  children.push(child);
  const opened: Record<string, string>[] = [];
  const launcher: Launcher = {
    name: "tmux",
    open: (_at, _argv, env = {}) => {
      opened.push({ ...env });
      const token = env[SEAT_TOKEN];
      if (!token) return "no token";
      holdSeat("ch", "lp", token, Date.now(), process.pid);
      bindHeldSeat("ch", "lp", token, { harness: "claude", session: "live", pid: child.pid }, "loop");
      return null;
    },
  };
  let n = 0;
  const deps = {
    load: loadConfig,
    now: () => Date.now(),
    sleep: async () => {},
    newId: () => "b".repeat(16),
    report: () => null,
    forget: () => {},
    token: () => `token-${++n}`,
    keyOf: (t: string) => t,
    reserve: (p: { alias: string; as: string }, token: string) => reserveSeat(p.alias, p.as, token, sessionLiveness),
    abandon: () => {},
  };
  const a = await upAll(plansA, launcher, ["kiwi"], 60, 10_000, deps);
  expect(a.map((o) => o.result)).toEqual(["restored"]);
  const b = await upAll(plansB, launcher, ["kiwi"], 60, 10_000, deps);
  expect(b.map((o) => o.result)).toEqual(["running"]);
  expect(opened.length).toBe(1);
  expect(seatOf("lp")).toMatchObject({ session: "live", pid: child.pid, loop: true });
});

test("the parent waits for each seat's own report: an intermediate bind that later fails wake checks is reported failed, not restored", async () => {
  place(dir, deadClaude("dev"));
  const launcher: Launcher = { name: "tmux", open: () => null };
  let ticks = 0;
  const deps = {
    load: loadConfig,
    now: () => Date.now() + ticks * 1_000,
    sleep: async () => {
      ticks++;
      if (ticks === 1)
        updateConfig((c: Config) => {
          c.bindings = { [dir]: { ...deadClaude("dev"), session: "mid", upKey: "k", at: Date.now() + 5_000 } };
        });
    },
    newId: () => "a".repeat(16),
    report: (): Report | null => (ticks >= 3 ? { result: "failed", why: "the new session can't be woken: hooks missing" } : null),
    forget: () => {},
    token: () => "t",
    keyOf: (t: string) => t,
    reserve: () => ({ kind: "held" as const, prior: [] }),
    abandon: () => {},
  };
  const outcomes = await upAll(planUp(loadConfig(), testLive), launcher, ["kiwi"], 60, 10_000, deps);
  expect(outcomes.map((o) => (o.result === "printed" ? o.line : [o.result, o.why]))).toEqual([["failed", "the new session can't be woken: hooks missing"]]);
  expect(ticks).toBe(3);
});

test("a session whose hooks never report taking the seat is stopped and the seat goes back to its record", async () => {
  place(dir, deadClaude("dev"));
  const before = seatOf("dev");
  const f = fake();
  f.hooked.value = false;
  const r = await restoreSeat("ch", "dev", 5_000, f.deps, {});
  expect(r).toEqual({ kind: "failed", why: "the new session's hooks never reported taking the seat (kiwi hooks status)" });
  expect(f.stopped.length).toBe(1);
  expect({ ...seatOf("dev"), holds: undefined }).toEqual({ ...before, holds: undefined });
});

test("--bind-timeout reaches every seat's own kiwi up, shorter or longer than the default", () => {
  const p = { kind: "restore" as const, harness: "claude" as const, alias: "ch", as: "dev", dir };
  expect(seatArgv(["kiwi"], p, { bindSeconds: 15, report: "f".repeat(16) })).toEqual(["kiwi", "up", "--seat", "dev", "-c", "ch", "--bind-timeout", "15", "--report", "f".repeat(16)]);
  expect(seatArgv(["kiwi"], p, { bindSeconds: 600 })).toEqual(["kiwi", "up", "--seat", "dev", "-c", "ch", "--bind-timeout", "600"]);
});

test("a loop kiwi up opened adopts its own live reservation, which turns into the loop's hold", () => {
  place(dir, { alias: "ch", as: "lp", harness: "claude", session: "gone", pid: DEAD_PID, loop: true, at: 1 });
  expect(reserveSeat("ch", "lp", "t1", testLive).kind).toBe("held");
  expect(adoptReserved("ch", "lp", "t1")).toEqual({ kind: "changed", seats: 1 });
  const hold = seatOf("lp")?.hold;
  expect(hold?.up).toBeUndefined();
  expect(hold?.holder?.pid).toBe(process.pid);
  expect(seatOf("lp")?.session).toBeUndefined();
  expect(adoptReserved("ch", "lp", "t1")).toEqual({ kind: "not-held" });
});

test("after kiwi up times out, its late loop adopts nothing: not the released seat, and not a replacement's live binding", () => {
  place(dir, { alias: "ch", as: "lp", harness: "claude", session: "gone", pid: DEAD_PID, loop: true, at: 1 });
  expect(reserveSeat("ch", "lp", "old", testLive).kind).toBe("held");
  abandonReserved("ch", "lp", "old");
  const released = JSON.stringify(loadConfig().bindings);
  expect(adoptReserved("ch", "lp", "old")).toEqual({ kind: "not-held" });
  expect(JSON.stringify(loadConfig().bindings)).toBe(released);
  const child = spawnOwned(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
  children.push(child);
  expect(reserveSeat("ch", "lp", "new", testLive).kind).toBe("held");
  expect(adoptReserved("ch", "lp", "new").kind).toBe("changed");
  bindHeldSeat("ch", "lp", "new", { harness: "claude", session: "live", pid: child.pid }, "loop");
  const bound = JSON.stringify(loadConfig().bindings);
  expect(adoptReserved("ch", "lp", "old")).toEqual({ kind: "not-held" });
  expect(JSON.stringify(loadConfig().bindings)).toBe(bound);
  expect(seatOf("lp")).toMatchObject({ session: "live", pid: child.pid, loop: true });
});

test("kiwi up --json reads back on the desktop side, seat by seat, and anything else is no answer", () => {
  const plan = { kind: "restore" as const, harness: "claude" as const, alias: "ch", as: "dev", dir: "/w" };
  const json = JSON.stringify({
    seats: [outcomeJson({ plan, result: "restored", why: "it resumed its session" }), outcomeJson({ plan, result: "printed", line: "kiwi up --seat dev -c ch" }), { handle: "broken" }],
  });
  expect(readUpOutcomes(json)).toEqual([
    { channel: "ch", handle: "dev", folder: "/w", result: "restored", why: "it resumed its session" },
    { channel: "ch", handle: "dev", folder: "/w", result: "printed", why: "kiwi up --seat dev -c ch" },
  ]);
  expect(readUpOutcomes("not json")).toBeNull();
  expect(readUpOutcomes(JSON.stringify({ findings: [] }))).toBeNull();
});

const noOpen = () => ({
  load: loadConfig,
  sleep: async () => {},
  now: () => Date.now(),
  newId: () => "0".repeat(16),
  report: (): Report | null => ({ result: "restored", why: "it resumed its session" }),
  forget: () => {},
  token: () => "t",
  keyOf: (t: string) => t,
  reserve: () => ({ kind: "held" as const, prior: [] }),
  abandon: () => {},
});

function twoChannels(): string {
  const other = join(home, "other");
  mkdirSync(other);
  updateConfig((c) => {
    c.channels.ops = { roomId: "r2", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "http://127.0.0.1:1", code: "mc2-y" };
  });
  place(dir, deadClaude("a"), deadClaude("b"));
  place(other, { ...deadClaude("c"), alias: "ops" });
  return other;
}

function pickFrom(plans: SeatPlan[], given: string[] | undefined): SeatPlan[] | string {
  const selection = readSelection(given);
  return typeof selection === "string" ? selection : pickSeats(plans, selection);
}

function picked(plans: SeatPlan[], given: string[]): SeatPlan[] {
  const got = pickFrom(plans, given);
  if (typeof got === "string") throw new Error(got);
  return got;
}

const names = (got: SeatPlan[] | string) => (typeof got === "string" ? got : got.map((p) => `${p.alias}/${p.as}`));

test("--only starts only the picked seats: two channels, three seats, one picked", async () => {
  const other = twoChannels();
  const opened: string[] = [];
  const launcher: Launcher = { name: "tmux", open: (at) => (opened.push(`${at.alias}/${at.as}`), null) };
  const outcomes = await upAll(picked(planUp(loadConfig(), testLive), ["ops/c"]), launcher, ["/bin/kiwi"], 60, 1_000, noOpen());
  expect(opened).toEqual(["ops/c"]);
  expect(outcomes.map((o) => [o.plan.alias, o.plan.as, o.plan.dir, o.result])).toEqual([["ops", "c", other, "restored"]]);
});

test("--only selectors are a union without duplicates, and without --only every seat is planned", () => {
  twoChannels();
  const plans = planUp(loadConfig(), testLive);
  expect(names(pickFrom(plans, ["ch", "ch/a", "ops/c"]))).toEqual(["ch/a", "ch/b", "ops/c"]);
  expect(names(pickFrom(plans, ["ch/b", "ch/b"]))).toEqual(["ch/b"]);
  expect(names(pickFrom(plans, undefined))).toEqual(["ch/a", "ch/b", "ops/c"]);
});

test("an invalid or unknown --only selector is refused before anything is planned to start", () => {
  twoChannels();
  const plans = planUp(loadConfig(), testLive);
  expect(["", "ch/", "/a", "ch/a/b", " ch", "ch/a "].map((bad) => pickFrom(plans, [bad]))).toEqual(
    ["", "ch/", "/a", "ch/a/b", " ch", "ch/a "].map((bad) => `--only takes CHANNEL or CHANNEL/HANDLE, not "${bad}"`),
  );
  expect(pickFrom(plans, ["ch/a", "nope", "ops/zz"])).toBe(`--only "nope", "ops/zz": no seat on this computer matches, so nothing started`);
});

test("a picked seat that came back since the plan was shown is reported running and never started twice", async () => {
  const other = twoChannels();
  expect(planUp(loadConfig(), testLive).find((p) => p.as === "c")?.kind).toBe("restore");
  place(other, { ...deadClaude("c"), alias: "ops", pid: process.pid, started: processStart(process.pid) ?? "" });
  const opened: string[] = [];
  const outcomes = await upAll(picked(planUp(loadConfig(), testLive), ["ops/c"]), { name: "tmux", open: (at) => (opened.push(at.as), null) }, ["/bin/kiwi"], 60, 1_000, noOpen());
  expect(opened).toEqual([]);
  expect(outcomes.map((o) => [o.plan.as, o.result])).toEqual([["c", "running"]]);
});

test("kiwi up --only refuses a bad selector, an unknown seat and --seat on the command line, starting nothing", async () => {
  twoChannels();
  const before = JSON.stringify(loadConfig());
  const run = async (...args: string[]) => {
    const p = spawnOwned(["bun", join(import.meta.dir, "../src/cli/main.ts"), "up", ...args], {
      cwd: home,
      env: { ...process.env, KIWI_HOME: home, KIWI_NO_HOOKS: "1", KIWI_TMUX: "kiwi-test-no-tmux", CLAUDE_CONFIG_DIR: join(home, "claude"), CLAUDECODE: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code: await p.exited, out, err };
  };
  const bad = await run("--only", "ch/a/b");
  expect(bad.code).not.toBe(0);
  expect(bad.err).toContain(`--only takes CHANNEL or CHANNEL/HANDLE, not "ch/a/b"`);
  const unknown = await run("--only", "ops/zz", "--json");
  expect(unknown.code).not.toBe(0);
  expect(unknown.out).toBe("");
  expect(unknown.err).toContain(`--only "ops/zz": no seat on this computer matches, so nothing started`);
  const withSeat = await run("--seat", "a", "--only", "ch");
  expect(withSeat.code).not.toBe(0);
  expect(withSeat.err).toContain("--only picks among every seat; drop --seat");
  expect(JSON.stringify(loadConfig())).toBe(before);
}, 30_000);

test("the desktop side reads the picker's plan with tmux, and passes only well-formed picks to kiwi up --only", () => {
  const plan = { kind: "restore" as const, harness: "claude" as const, alias: "ch", as: "dev", dir: "/w" };
  const seats = [planJson(plan, true)];
  expect(readUpChoices(JSON.stringify({ seats, tmux: false }))).toEqual({
    seats: [{ channel: "ch", handle: "dev", folder: "/w", result: "planned", why: "kiwi up --seat dev -c ch", before: true }],
    tmux: false,
  });
  expect(readUpChoices(JSON.stringify({ seats }))).toBeNull();
  expect(readUpChoices("not json")).toBeNull();
  expect(
    readUpPicks([
      { channel: "ch", handle: "dev" },
      { channel: "my ch", handle: "x;y" },
    ]),
  ).toEqual([
    { channel: "ch", handle: "dev" },
    { channel: "my ch", handle: "x;y" },
  ]);
  expect(onlyArgs([{ channel: "ch", handle: "dev" }])).toEqual(["--only=ch/dev"]);
  expect([[], [{ channel: "ch" }], [{ channel: "ch/x", handle: "dev" }], [{ channel: "ch", handle: " dev" }], [{ channel: "", handle: "dev" }], "ch/dev", null].map(readUpPicks)).toEqual([
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
});

test("--only still reads a picked channel's roster through every local seat in it: a picked seat without a usable key is checked through its neighbour", () => {
  twoChannels();
  const every = planUp(loadConfig(), testLive);
  const pickedSeats = picked(every, ["ch/a"]);
  const readers = readersFor(every, pickedSeats);
  expect(names(readers)).toEqual(["ch/a", "ch/b"]);
  const readableThrough = new Set(["b"]);
  const member = (_alias: string, as: string) =>
    readers.some((r) => readableThrough.has(r.as)) ? (as === "a" ? { kind: "member" as const } : { kind: "left" as const }) : { kind: "unverified" as const, why: "no agent here could read it" };
  expect(withMembers(pickedSeats, member).map((p) => [p.as, p.kind])).toEqual([["a", "restore"]]);
  const alone = () => (pickedSeats.some((r) => readableThrough.has(r.as)) ? { kind: "member" as const } : { kind: "unverified" as const, why: "no agent here could read it" });
  expect(withMembers(pickedSeats, alone).map((p) => [p.as, p.kind])).toEqual([["a", "skipped"]]);
  expect(names(readersFor(every, picked(every, ["ops/c"])))).toEqual(["ops/c"]);
});

test("the picker's plan decodes strictly: a malformed row or a missing tmux is no plan, an empty plan is a plan, and kiwi up --json outcomes stay lenient", () => {
  const good = { channel: "work", handle: "a", folder: "/w", result: "planned" as const, why: "kiwi up --seat a -c work" };
  expect(readUpChoices(JSON.stringify({ tmux: true, seats: [{ channel: "work", handle: "a", result: "planned" }] }))).toBeNull();
  expect(readUpChoices(JSON.stringify({ tmux: true, seats: [good, { handle: "broken" }] }))).toBeNull();
  expect(readUpChoices(JSON.stringify({ seats: [good] }))).toBeNull();
  expect(readUpChoices(JSON.stringify({ tmux: "yes", seats: [good] }))).toBeNull();
  expect(readUpChoices(JSON.stringify({ tmux: true, seats: [] }))).toEqual({ seats: [], tmux: true });
  expect(readUpChoices(JSON.stringify({ tmux: false, seats: [good] }))).toEqual({ seats: [good], tmux: false });
  expect(readUpOutcomes(JSON.stringify({ seats: [good, { handle: "broken" }] }))).toEqual([good]);
});
