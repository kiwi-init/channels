import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONTEXT_LINE } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState } from "@kiwi/core/state.ts";
import { paneOf, rotateArgv } from "../src/hooks/rotate.ts";
import { ROTATE_FLOOR, rotationAt } from "../src/rotate/decide.ts";
import { clearWhenIdle, inputEmpty } from "../src/rotate/pane.ts";

const board = (tasks: object[], extra: Partial<ChannelState> = {}): ChannelState => {
  const state = fold([], []);
  for (const t of tasks) {
    const task = { title: "t", state: "doing", notes: [], rounds: [], ...t } as never as { id: number };
    state.tasks.set(task.id, task as never);
  }
  return Object.assign(state, extra);
};
const checkpoint = (ts: number) => ({ seq: 1, by: "ana", ts, text: "where it stands", checkpoint: true as const });

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

  test("the lead only past the line", () => {
    expect(rotationAt(board([], { lead: "ana" }), "ana", CONTEXT_LINE - 1, null).kind).toBe("stay");
    expect(rotationAt(board([], { lead: "ana" }), "ana", CONTEXT_LINE, null).kind).toBe("rotate");
  });

  test("with open tasks, only past the line and once each has a checkpoint since the nudge", () => {
    const mine = (ts: number) =>
      board([
        { id: 1, owner: "ana", notes: [checkpoint(ts)] },
        { id: 2, owner: "ana", notes: [checkpoint(900)] },
      ]);
    expect(rotationAt(mine(900), "ana", CONTEXT_LINE - 1, 500).kind).toBe("stay");
    expect(rotationAt(mine(900), "ana", CONTEXT_LINE, null).kind).toBe("stay");
    expect(rotationAt(mine(400), "ana", CONTEXT_LINE, 500).kind).toBe("stay");
    expect(rotationAt(mine(500), "ana", CONTEXT_LINE, 500).kind).toBe("rotate");
    expect(rotationAt(board([{ id: 1, owner: "ana" }], { lead: "ana" }), "ana", CONTEXT_LINE, 500).kind).toBe("stay");
  });

  test("never while a review round it judges is open, or a question of its to a person is", () => {
    const round = { n: 1, result: { kind: "open" } };
    expect(rotationAt(board([{ id: 1, owner: "bo", review: "ana", rounds: [round] }]), "ana", 900_000, null).kind).toBe("stay");
    expect(rotationAt(board([{ id: 1, owner: "bo", review: "ana", rounds: [{ n: 1, result: { kind: "approved" } }] }]), "ana", 900_000, null).kind).toBe("rotate");
    expect(rotationAt(board([], { openAsks: [{ from: "ana" } as never] }), "ana", 900_000, null).kind).toBe("stay");
    expect(rotationAt(board([], { openAsks: [{ from: "bo" } as never] }), "ana", 900_000, null).kind).toBe("rotate");
  });
});

describe("Claude Code's input line in a captured pane", () => {
  test("empty when it shows only the dim placeholder or nothing; typed text, or a menu, isn't", () => {
    expect(inputEmpty('\x1b[39m❯ \x1b[2mTry\x1b[0m \x1b[2m"write\x1b[0m \x1b[2ma\x1b[0m \x1b[2mtest"\x1b[0m')).toBe(true);
    expect(inputEmpty("old turn\n❯ earlier prompt\n● ok\n\x1b[39m❯  ")).toBe(true);
    expect(inputEmpty("\x1b[39m❯ half typed")).toBe(false);
    expect(inputEmpty("\x1b[39m❯ \x1b[2mTry\x1b[0m x")).toBe(false);
    expect(inputEmpty(" ❯ No, exit\n   Yes, I trust this folder")).toBe(false);
    expect(inputEmpty("no prompt here")).toBeNull();
  });

  test("the pane comes from tmux's own variables, and the sender is this kiwi", () => {
    expect(paneOf({ TMUX: "/tmp/tmux-1000/default,1234,0", TMUX_PANE: "%2" })).toEqual({ pane: "%2", socket: "/tmp/tmux-1000/default" });
    expect(paneOf({ TMUX_PANE: "%2" })).toBeNull();
    expect(paneOf({ TMUX: "/s,1,0", TMUX_PANE: "2" })).toBeNull();
    expect(rotateArgv(42, "s-1", { pane: "%2", socket: "/s" }).slice(-6)).toEqual(["rotate", "send", "42", "s-1", "%2", "/s"]);
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

  async function pane(name: string, shown: string): Promise<{ pane: string; pid: number; typed: string; claudeDir: string }> {
    const typed = join(dir, `${name}.typed`);
    const script = join(dir, `${name}.sh`);
    writeFileSync(script, `printf '%s' "${shown}"\nexec cat > ${typed}\n`);
    spawnSync("tmux", ["-S", socket, "new-session", "-d", "-s", name, "-x", "120", "-y", "20", `sh ${script}`]);
    const [id, pid] = spawnSync("tmux", ["-S", socket, "display-message", "-p", "-t", name, "#{pane_id} #{pane_pid}"], { encoding: "utf8" }).stdout.trim().split(" ");
    const claudeDir = join(dir, `${name}-claude`);
    mkdirSync(join(claudeDir, "sessions"), { recursive: true });
    await Bun.sleep(300);
    return { pane: id!, pid: Number(pid), typed, claudeDir };
  }
  const registry = (p: { pid: number; claudeDir: string }, session: string, status: string) =>
    writeFileSync(join(p.claudeDir, "sessions", `${p.pid}.json`), JSON.stringify({ pid: p.pid, sessionId: session, status }));
  const fast = { timeoutMs: 1_500, everyMs: 100, quietMs: 0 };

  test("an idle session with an empty input line gets /clear and Enter", async () => {
    const p = await pane("idle", "❯ ");
    registry(p, "s-1", "idle");
    expect(await clearWhenIdle({ pid: p.pid, session: "s-1", pane: p.pane, socket, claudeDir: p.claudeDir }, fast)).toBe("cleared");
    await Bun.sleep(300);
    expect(readFileSync(p.typed, "utf8")).toBe("/clear\n");
  });

  test("a busy session, text being typed, or a session that already moved on gets nothing", async () => {
    const busy = await pane("busy", "❯ ");
    registry(busy, "s-2", "busy");
    expect(await clearWhenIdle({ pid: busy.pid, session: "s-2", pane: busy.pane, socket, claudeDir: busy.claudeDir }, fast)).toBe("timed-out");
    const typing = await pane("typing", "❯ half typed");
    registry(typing, "s-3", "idle");
    expect(await clearWhenIdle({ pid: typing.pid, session: "s-3", pane: typing.pane, socket, claudeDir: typing.claudeDir }, fast)).toBe("timed-out");
    const moved = await pane("moved", "❯ ");
    registry(moved, "s-new", "idle");
    expect(await clearWhenIdle({ pid: moved.pid, session: "s-4", pane: moved.pane, socket, claudeDir: moved.claudeDir }, fast)).toBe("moved");
    await Bun.sleep(300);
    for (const p of [busy, typing, moved]) expect(existsSync(p.typed) ? readFileSync(p.typed, "utf8") : "").toBe("");
    expect(readFileSync(join(dir, "kiwi", "rotate.log"), "utf8")).toContain("timed-out");
  });

  test("a process that isn't in the pane is never typed into", async () => {
    const p = await pane("other", "❯ ");
    registry({ pid: process.pid, claudeDir: p.claudeDir }, "s-5", "idle");
    expect(await clearWhenIdle({ pid: process.pid, session: "s-5", pane: p.pane, socket, claudeDir: p.claudeDir }, fast)).toBe("not-its-pane");
  });
});
