import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { placedSeatsOf, seatId, terminalCalls, type Run } from "../src/mods-terminal.ts";

const ROOM = "b6d383226365dd0ba576eff3d66f71a0";
const tmuxBin = ((): string | null => {
  for (const bin of ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"])
    try {
      execFileSync(bin, ["-V"]);
      return bin;
    } catch {
      // Not installed here: try the next place.
    }
  return null;
})();

const dir = mkdtempSync("/tmp/kiwi-tmux-");
const socket = join(dir, "s");
const tmux = (...args: string[]): string => execFileSync(tmuxBin!, ["-u", "-S", socket, ...args], { encoding: "utf8" }).trim();
const run: Run = async (argv) => {
  try {
    return { status: 0, stdout: execFileSync(argv[0]!, argv.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), stderr: "" };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? null, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
};

describe.skipIf(!tmuxBin && !process.env["CI"])("a terminal mod against a real tmux", () => {
  let first = "";
  let second = "";
  let pane = "";

  beforeAll(() => {
    tmux("-f", "/dev/null", "new-session", "-d", "-s", "kiwi", "-x", "80", "-y", "24");
    tmux("new-window", "-t", "kiwi");
    const rows = tmux("list-panes", "-s", "-t", "kiwi", "-F", "#{window_id} #{pane_id}").split("\n");
    [first, pane] = rows[0]!.split(" ") as [string, string];
    second = rows[1]!.split(" ")[0]!;
  });

  afterAll(() => {
    try {
      tmux("kill-server");
    } catch {
      // The server already stopped: nothing left running.
    }
    rmSync(dir, { recursive: true, force: true });
  });

  const calls = () =>
    terminalCalls({
      seats: async () => placedSeatsOf(JSON.stringify({ seats: [{ room: ROOM, alias: "dev", agent: "ana", place: { tmux: { socket, pane } } }] })),
      run,
      tmux: () => tmuxBin,
      rex: () => null,
      write: () => false,
      front: async () => {},
    });

  test("Show agent brings the agent's window forward", async () => {
    expect(tmux("display-message", "-p", "-t", "kiwi", "#{window_id}")).toBe(second);
    await calls().focus(seatId(ROOM, "ana"));
    expect(tmux("display-message", "-p", "-t", "kiwi", "#{window_id}")).toBe(first);
    expect(tmux("display-message", "-p", "-t", "kiwi", "#{pane_id}")).toBe(pane);
  });

  test("a mark shows on the agent's window and clears when it's answered", async () => {
    const c = calls();
    await c.mark(seatId(ROOM, "ana"), { asks: 2, tasks: [7] });
    expect(tmux("show-options", "-wqv", "-t", first, "@kiwi")).toBe("2? T7");
    expect(tmux("show-options", "-wqv", "-t", second, "@kiwi")).toBe("");
    await c.mark(seatId(ROOM, "ana"), null);
    expect(tmux("show-options", "-wqv", "-t", first, "@kiwi")).toBe("");
  });
});
