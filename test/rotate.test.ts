import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTEXT_LINE, PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts";
import { fold, leadCheckpointKey, type ChannelState, type Place } from "@kiwi/core/state.ts";
import { alive } from "../src/hooks/listeners.ts";
import { paneOf, rotateArgv } from "../src/hooks/rotate.ts";
import { ROTATE_FLOOR, rotationAt } from "../src/rotate/decide.ts";
import { calm, clearWhenIdle, dropLock, forgetStay, inputText, noteStay, rotating, takeLock } from "../src/rotate/pane.ts";

const board = (tasks: object[], extra: Partial<ChannelState> = {}): ChannelState => {
  const state = fold([], []);
  for (const t of tasks) {
    const task = { title: "t", state: "doing", notes: [], rounds: [], ...t } as never as { id: number };
    state.tasks.set(task.id, task as never);
  }
  return Object.assign(state, extra);
};
const askOf = (seq: number, from: string): Message => ({ v: PROTOCOL_VERSION, id: `m-${seq}`, from, kind: "ask", body: "which one?", ts: 1, seq, sigOk: true });
const inTask = (seq: number, task: number) => new Map<number, Place>([[seq, { kind: "task", task }]]);
const checkpoint = (seq: number) => ({ seq, by: "ana", ts: 1, text: "where it stands", checkpoint: true as const });

describe("when a seat rotates", () => {
  test("between tasks past the floor, never under it, and never with its context unknown", () => {
    expect(rotationAt(board([]), "ana", ROTATE_FLOOR, null).kind).toBe("rotate");
    expect(rotationAt(board([]), "ana", ROTATE_FLOOR - 1, null).kind).toBe("stay");
    expect(rotationAt(board([]), "ana", undefined, null).kind).toBe("stay");
    expect(
      rotationAt(
        board([
          { id: 1, owner: "bo" },
          { id: 2, owner: "ana", state: "done" },
        ]),
        "ana",
        ROTATE_FLOOR,
        null,
      ).kind,
    ).toBe("rotate");
  });

  test("the lead only past the line, and once its own lead checkpoint is later in the channel than the nudge", () => {
    const key = leadCheckpointKey("ana");
    const led = (seq: number | null, by = "ana", extra: object = {}) =>
      board([], { lead: "ana", facts: new Map(seq === null ? [] : [[key, { key, value: "waiting on bo for T3", by, ts: 1, seq, ...extra }]]) });
    expect(rotationAt(led(90), "ana", CONTEXT_LINE - 1, 50)).toEqual({ kind: "stay", why: "the lead, under the line" });
    expect(rotationAt(led(null), "ana", CONTEXT_LINE, 50)).toEqual({ kind: "stay", why: "the lead, past the line, waiting for its lead checkpoint" });
    expect(rotationAt(led(90), "ana", CONTEXT_LINE, null).kind).toBe("stay");
    expect(rotationAt(led(50), "ana", CONTEXT_LINE, 50).kind).toBe("stay");
    expect(rotationAt(led(51, "bo"), "ana", CONTEXT_LINE, 50).kind).toBe("stay");
    expect(rotationAt(led(51, "ana", { expires: Date.now() + 60_000 }), "ana", CONTEXT_LINE, 50).kind).toBe("stay");
    expect(rotationAt(board([], { lead: "ana", facts: new Map([["lead checkpoint", { key: "lead checkpoint", value: "x", by: "ana", ts: 1, seq: 51 }]]) }), "ana", CONTEXT_LINE, 50).kind).toBe("stay");
    expect(rotationAt(led(51), "ana", CONTEXT_LINE, 50)).toEqual({ kind: "rotate", why: "the lead, past the line, with its lead checkpoint since the nudge" });
    expect(rotationAt({ ...led(51), lead: "bo" }, "ana", ROTATE_FLOOR, 50)).toEqual({ kind: "rotate", why: "between tasks" });
  });

  test("a lead with open tasks needs both: a checkpoint on each task and its lead checkpoint since the nudge", () => {
    const both = (task: number, lead: number) =>
      board([{ id: 1, owner: "ana", notes: [checkpoint(task)] }], {
        lead: "ana",
        facts: new Map([[leadCheckpointKey("ana"), { key: leadCheckpointKey("ana"), value: "x", by: "ana", ts: 1, seq: lead }]]),
      });
    expect(rotationAt(both(60, 40), "ana", CONTEXT_LINE, 50).why).toBe("the lead, past the line, waiting for its lead checkpoint");
    expect(rotationAt(both(40, 60), "ana", CONTEXT_LINE, 50).why).toBe("past the line, waiting for a checkpoint on each open task");
    expect(rotationAt(both(60, 61), "ana", CONTEXT_LINE, 50).kind).toBe("rotate");
    expect(rotationAt(both(60, 61), "ana", CONTEXT_LINE - 1, 50).why).toBe("the lead, under the line");
  });

  test("with open tasks, only past the line and once each has a checkpoint later in the channel than the nudge", () => {
    const mine = (seq: number) =>
      board([
        { id: 1, owner: "ana", notes: [checkpoint(seq)] },
        { id: 2, owner: "ana", notes: [checkpoint(90)] },
      ]);
    expect(rotationAt(mine(90), "ana", CONTEXT_LINE - 1, 50).kind).toBe("stay");
    expect(rotationAt(mine(90), "ana", CONTEXT_LINE, null).kind).toBe("stay");
    expect(rotationAt(mine(50), "ana", CONTEXT_LINE, 50).kind).toBe("stay");
    expect(rotationAt(mine(51), "ana", CONTEXT_LINE, 50).kind).toBe("rotate");
    expect(rotationAt(board([{ id: 1, owner: "ana" }], { lead: "ana" }), "ana", CONTEXT_LINE, 50).kind).toBe("stay");
  });

  test("never while a review round it judges is open, or a question of its to a person is", () => {
    const round = { n: 1, result: { kind: "open" } };
    expect(rotationAt(board([{ id: 1, owner: "bo", review: "ana", rounds: [round] }]), "ana", 900_000, null).kind).toBe("stay");
    expect(rotationAt(board([{ id: 1, owner: "bo", review: "ana", rounds: [{ n: 1, result: { kind: "approved" } }] }]), "ana", 900_000, null).kind).toBe("rotate");
    expect(rotationAt(board([], { openAsks: [askOf(7, "ana")] }), "ana", 900_000, null).kind).toBe("stay");
    expect(rotationAt(board([], { openAsks: [askOf(7, "bo")] }), "ana", 900_000, null).kind).toBe("rotate");
  });

  test("a question of its in a done or archived task's thread no longer holds it, one in an open task's or outside any task does", () => {
    const asked = (task: object | null) => board(task ? [{ id: 1, owner: "bo", ...task }] : [], { openAsks: [askOf(7, "ana")], placeOf: inTask(7, 1) });
    expect(rotationAt(asked({ state: "done" }), "ana", 900_000, null).kind).toBe("rotate");
    expect(rotationAt(asked({ archived: true }), "ana", 900_000, null).kind).toBe("rotate");
    expect(rotationAt(asked({}), "ana", 900_000, null)).toEqual({ kind: "stay", why: "a question of its to a person is open" });
    expect(rotationAt(asked(null), "ana", 900_000, null).kind).toBe("stay");
    expect(rotationAt(board([{ id: 1, owner: "bo", state: "done" }], { openAsks: [askOf(7, "ana")] }), "ana", 900_000, null).kind).toBe("stay");
  });
});

const RULE = "─".repeat(40);
const box = (input: string, below: string[] = ["  ⏵⏵ auto mode on"]) => ["● ok", "❯ an earlier prompt", RULE, input, RULE, ...below].join("\n");

describe("Claude Code's input box in a captured pane", () => {
  test("the text between its two rules, the dim placeholder and the prompt glyph left out", () => {
    expect(inputText(box('\x1b[39m❯ \x1b[2mTry\x1b[0m \x1b[2m"write\x1b[0m \x1b[2ma test"\x1b[0m'))).toBe("");
    expect(inputText(box("❯ "))).toBe("");
    expect(inputText(box("❯ half typed"))).toBe("half typed");
    expect(inputText(box("❯ my draft ends with ❯"))).toBe("my draft ends with ❯");
    expect(inputText(box("❯ line one\n  line two"))).toBe("line one\n  line two");
    expect(inputText(box("❯ \x1b[2mTry\x1b[0m x"))).toBe("x");
  });

  test("anything else on screen is no box: a dialog, a stale prompt above one, a missing rule", () => {
    expect(inputText(" ❯ No, exit\n   Yes, I trust this folder")).toBeNull();
    expect(inputText([RULE, "❯ ", RULE, "Allow this command?", " ❯ Yes", "   No", "   Always", "Esc to cancel"].join("\n"))).toBeNull();
    expect(inputText([RULE, "  Accessing workspace", RULE, "❯ "].join("\n"))).toBeNull();
    expect(inputText("❯ \nno rules here")).toBeNull();
  });

  test("with /clear typed, the command list Claude Code shows under the box is allowed", () => {
    const listed = ["  ❯ /clear   Start a new session", "    /cleanup", "    /color", "    /compact"];
    expect(inputText(box("❯ /clear", listed), null)).toBe("/clear");
    expect(inputText(box("❯ /clear", listed))).toBeNull();
  });

  test("a client is quiet only when none pressed a key within the window", () => {
    expect(calm([], 50_000, 10_000)).toBe(true);
    expect(calm([30], 50_000, 10_000)).toBe(true);
    expect(calm([30, 45], 50_000, 10_000)).toBe(false);
  });

  test("the pane comes from tmux's own variables, and the sender is this kiwi", () => {
    expect(paneOf({ TMUX: "/tmp/tmux-1000/default,1234,0", TMUX_PANE: "%2" })).toEqual({ pane: "%2", socket: "/tmp/tmux-1000/default" });
    expect(paneOf({ TMUX_PANE: "%2" })).toBeNull();
    expect(paneOf({ TMUX: "/s,1,0", TMUX_PANE: "2" })).toBeNull();
    expect(rotateArgv(42, "s-1", { pane: "%2", socket: "/s" }).slice(-6)).toEqual(["rotate", "send", "42", "s-1", "%2", "/s"]);
  });
});

describe("one sender per session", () => {
  let dir = "";
  let was: string | undefined;
  beforeAll(() => {
    was = process.env.KIWI_HOME;
    dir = mkdtempSync(join(tmpdir(), "kiwi-rotate-lock-"));
    process.env.KIWI_HOME = dir;
  });
  afterAll(() => {
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    rmSync(dir, { recursive: true, force: true });
  });

  test("a sender holds the session only while no other live sender does, and a dead sender's file is ignored", () => {
    const other = process.ppid;
    expect(takeLock("s-1")).toBe(true);
    expect(rotating("s-1", other)).toBe(true);
    expect(takeLock("s-1", other)).toBe(false);
    expect(existsSync(join(dir, "hook-state", `s-1.rotating.${other}`))).toBe(false);
    dropLock("s-1", other);
    expect(rotating("s-1", other)).toBe(true);
    dropLock("s-1");
    expect(rotating("s-1", other)).toBe(false);
    mkdirSync(join(dir, "hook-state"), { recursive: true });
    writeFileSync(join(dir, "hook-state", "s-2.rotating.999999999"), "");
    expect(takeLock("s-2")).toBe(true);
    expect(existsSync(join(dir, "hook-state", "s-2.rotating.999999999"))).toBe(false);
    dropLock("s-2");
  });

  test("a seat that stays is logged once per reason, again after a rotation, and alongside a lock of the same session", () => {
    const at = { pid: 42, session: "s-4", pane: "%2" };
    const lines = () => (existsSync(join(dir, "rotate.log")) ? readFileSync(join(dir, "rotate.log"), "utf8") : "").split("\n").filter((l) => l.includes("session s-4"));
    noteStay(at, "kiwi/ana", "between tasks, with a small context");
    noteStay(at, "kiwi/ana", "between tasks, with a small context");
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(/^\d{4}-\d\d-\d\dT\S+ pid 42 session s-4 pane %2: stays \(kiwi\/ana\): between tasks, with a small context$/);
    noteStay(at, "kiwi/ana", "a question of its to a person is open");
    noteStay(at, "kiwi/ana", "a question of its to a person is open");
    expect(lines()).toHaveLength(2);
    noteStay({ ...at, session: "s-5" }, "kiwi/ana", "a question of its to a person is open");
    expect(lines()).toHaveLength(2);
    forgetStay("s-4");
    noteStay(at, "kiwi/ana", "a question of its to a person is open");
    expect(lines()).toHaveLength(3);
    expect(takeLock("s-4")).toBe(true);
    expect(rotating("s-4", process.ppid)).toBe(true);
    dropLock("s-4");
  });

  test("a stay whose line could not be written is tried again at the next stop", () => {
    const at = { pid: 42, session: "s-6", pane: "%2" };
    const log = join(dir, "rotate.log");
    const kept = existsSync(log) ? readFileSync(log, "utf8") : "";
    rmSync(log, { force: true });
    mkdirSync(log);
    noteStay(at, "kiwi/ana", "between tasks, with a small context");
    expect(existsSync(join(dir, "hook-state", "s-6.rotate-stay"))).toBe(false);
    rmSync(log, { recursive: true });
    writeFileSync(log, kept);
    noteStay(at, "kiwi/ana", "between tasks, with a small context");
    expect(readFileSync(log, "utf8")).toContain("session s-6 pane %2: stays (kiwi/ana): between tasks, with a small context");
  });

  test("two senders that start together both back off rather than both send", () => {
    const other = process.ppid;
    writeFileSync(join(dir, "hook-state", `s-3.rotating.${other}`), "");
    expect(takeLock("s-3")).toBe(false);
    expect(existsSync(join(dir, "hook-state", `s-3.rotating.${process.pid}`))).toBe(false);
    dropLock("s-3", other);
  });
});

const hasTmux = spawnSync("tmux", ["-V"]).status === 0;

describe.skipIf(!hasTmux)("typing /clear into the pane", () => {
  let dir = "";
  let socket = "";
  let was: string | undefined;
  beforeAll(() => {
    was = process.env.KIWI_HOME;
    dir = mkdtempSync(join(tmpdir(), "kiwi-rotate-"));
    socket = join(dir, "tmux.sock");
    process.env.KIWI_HOME = join(dir, "kiwi");
  });
  afterAll(() => {
    spawnSync("tmux", ["-S", socket, "kill-server"]);
    if (was === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = was;
    rmSync(dir, { recursive: true, force: true });
  });

  interface PaneOpts {
    echo?: boolean;
    raw?: boolean;
    hup?: boolean;
    sock?: string;
  }
  async function pane(name: string, input: string, o: PaneOpts = {}): Promise<{ pane: string; pid: number; typed: string; claudeDir: string }> {
    const typed = join(dir, `${name}.typed`);
    const script = join(dir, `${name}.sh`);
    const setup = [o.echo === false ? "stty -echo" : "", o.raw ? "stty -icanon min 1" : "", o.hup ? "trap '' HUP" : ""].filter(Boolean).join("\n");
    writeFileSync(
      script,
      `${setup}\nprintf '%s\\n❯ %s\\n%s\\n  footer\\n\\033[3A\\033[%sG' '${RULE}' '${input}' '${RULE}' '${3 + input.length}'\n${o.hup ? "exec sleep 60" : `exec cat > ${typed}`}\n`,
    );
    const sock = o.sock ?? socket;
    spawnSync("tmux", ["-S", sock, "new-session", "-d", "-s", name, "-x", "120", "-y", "20", `sh ${script}`]);
    const [id, pid] = spawnSync("tmux", ["-S", sock, "display-message", "-p", "-t", name, "#{pane_id} #{pane_pid}"], { encoding: "utf8" }).stdout.trim().split(" ");
    const claudeDir = join(dir, `${name}-claude`);
    mkdirSync(join(claudeDir, "sessions"), { recursive: true });
    await Bun.sleep(300);
    return { pane: id!, pid: Number(pid), typed, claudeDir };
  }
  const registry = (p: { pid: number; claudeDir: string }, session: string, status: string) =>
    writeFileSync(join(p.claudeDir, "sessions", `${p.pid}.json`), JSON.stringify({ pid: p.pid, sessionId: session, status }));
  const fast = { timeoutMs: 1_200, everyMs: 100, quietMs: 0 };
  const typedOf = (p: { typed: string }) => (existsSync(p.typed) ? readFileSync(p.typed, "utf8") : "");

  test("an idle session with an empty input box gets /clear, and Enter only once /clear shows in the box", async () => {
    const p = await pane("idle", "");
    registry(p, "s-1", "idle");
    expect(await clearWhenIdle({ harness: "claude", pid: p.pid, session: "s-1", pane: p.pane, socket, claudeDir: p.claudeDir }, fast)).toBe("cleared");
    await Bun.sleep(300);
    expect(typedOf(p)).toBe("/clear\n");
  });

  test("when /clear doesn't show in the box after typing it, no Enter follows", async () => {
    const p = await pane("blind", "", { echo: false });
    registry(p, "s-6", "idle");
    expect(await clearWhenIdle({ harness: "claude", pid: p.pid, session: "s-6", pane: p.pane, socket, claudeDir: p.claudeDir }, fast)).toBe("left-in-input");
    await Bun.sleep(300);
    expect(typedOf(p)).toBe("");
  });

  test("a busy session, text being typed, a session already moved on, or a second sender gets nothing", async () => {
    const busy = await pane("busy", "");
    registry(busy, "s-2", "busy");
    const elsewhere = join(dir, "kiwi", "hook-state", `s-2.rotating.${process.ppid}`);
    mkdirSync(join(dir, "kiwi", "hook-state"), { recursive: true });
    writeFileSync(elsewhere, "");
    expect(await clearWhenIdle({ harness: "claude", pid: busy.pid, session: "s-2", pane: busy.pane, socket, claudeDir: busy.claudeDir }, fast)).toBe("busy-elsewhere");
    rmSync(elsewhere);
    expect(await clearWhenIdle({ harness: "claude", pid: busy.pid, session: "s-2", pane: busy.pane, socket, claudeDir: busy.claudeDir }, fast)).toBe("timed-out");
    const typing = await pane("typing", "half typed");
    registry(typing, "s-3", "idle");
    expect(await clearWhenIdle({ harness: "claude", pid: typing.pid, session: "s-3", pane: typing.pane, socket, claudeDir: typing.claudeDir }, fast)).toBe("timed-out");
    const moved = await pane("moved", "");
    registry(moved, "s-new", "idle");
    expect(await clearWhenIdle({ harness: "claude", pid: moved.pid, session: "s-4", pane: moved.pane, socket, claudeDir: moved.claudeDir }, fast)).toBe("moved");
    await Bun.sleep(300);
    for (const p of [busy, typing, moved]) expect(typedOf(p)).toBe("");
    expect(readFileSync(join(dir, "kiwi", "rotate.log"), "utf8")).toContain("timed-out");
  });

  test("with /clear typed and the switch turned off before Enter, the sender erases its own six characters", async () => {
    const p = await pane("off", "", { raw: true });
    registry(p, "s-7", "idle");
    let calls = 0;
    const on = () => ++calls < 2;
    expect(await clearWhenIdle({ harness: "claude", pid: p.pid, session: "s-7", pane: p.pane, socket, claudeDir: p.claudeDir }, { ...fast, on })).toBe("switched-off");
    await Bun.sleep(300);
    expect(typedOf(p)).toBe(`/clear${"\x7f".repeat(6)}`);
  });

  test("switched off and the session lost at once after typing, it erases nothing", async () => {
    const p = await pane("off-lost", "", { raw: true });
    registry(p, "s-11", "idle");
    let calls = 0;
    const on = () => {
      if (++calls < 2) return true;
      registry(p, "s-other", "idle");
      return false;
    };
    expect(await clearWhenIdle({ harness: "claude", pid: p.pid, session: "s-11", pane: p.pane, socket, claudeDir: p.claudeDir }, { ...fast, on })).toBe("left-in-input");
    await Bun.sleep(300);
    expect(typedOf(p)).toBe("/clear");
  });

  test("with /clear typed and the session moved on before Enter, nothing more is sent to the pane", async () => {
    const p = await pane("lost", "", { raw: true });
    registry(p, "s-8", "idle");
    let calls = 0;
    const on = () => {
      if (++calls === 2) registry(p, "s-other", "busy");
      return true;
    };
    expect(await clearWhenIdle({ harness: "claude", pid: p.pid, session: "s-8", pane: p.pane, socket, claudeDir: p.claudeDir }, { ...fast, on })).toBe("moved");
    await Bun.sleep(300);
    expect(typedOf(p)).toBe("/clear");
  });

  test("a client that pressed a key within the quiet window holds the sender back", async () => {
    const p = await pane("watched", "");
    registry(p, "s-9", "idle");
    const client = Bun.spawn(["tmux", "-S", socket, "-C", "attach", "-t", "watched"], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    client.stdin.write("refresh-client\n");
    await client.stdin.flush();
    await Bun.sleep(300);
    try {
      expect(await clearWhenIdle({ harness: "claude", pid: p.pid, session: "s-9", pane: p.pane, socket, claudeDir: p.claudeDir }, { ...fast, quietMs: 60_000 })).toBe("timed-out");
    } finally {
      client.kill();
    }
    expect(typedOf(p)).toBe("");
  });

  test("a tmux server started again on the same socket is not the pane the sender was given", async () => {
    const sock = join(dir, "again.sock");
    const p = await pane("again", "", { hup: true, sock });
    registry(p, "s-10", "busy");
    const waiting = clearWhenIdle({ harness: "claude", pid: p.pid, session: "s-10", pane: p.pane, socket: sock, claudeDir: p.claudeDir }, { ...fast, timeoutMs: 3_000 });
    await Bun.sleep(300);
    const server = Number(spawnSync("tmux", ["-S", sock, "display-message", "-p", "#{pid}"], { encoding: "utf8" }).stdout.trim());
    spawnSync("tmux", ["-S", sock, "kill-server"]);
    const end = Date.now() + 2_000;
    while (alive(server) && Date.now() < end) Bun.sleepSync(10);
    await pane("again-new", "", { sock });
    registry(p, "s-10", "idle");
    expect(await waiting).toBe("not-its-pane");
    spawnSync("tmux", ["-S", sock, "kill-server"]);
    spawnSync("kill", [String(p.pid)]);
  });

  test("a process that doesn't hold the pane's input is never typed into", async () => {
    const p = await pane("other", "");
    registry({ pid: process.pid, claudeDir: p.claudeDir }, "s-5", "idle");
    expect(await clearWhenIdle({ harness: "claude", pid: process.pid, session: "s-5", pane: p.pane, socket, claudeDir: p.claudeDir }, fast)).toBe("not-its-pane");
    expect(typedOf(p)).toBe("");
  });
});
