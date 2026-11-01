import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPlacedSeat, type PlacedSeat } from "@kiwi/core/terminals.ts";
import type { Config } from "../src/config.ts";
import { hostedSocket } from "../src/daemon/hosted-tmux.ts";
import { attachArgv, attachLine, linuxTerminal, showHosted, type TerminalOpener } from "../src/terminals/hosted.ts";
import type { Ran } from "../src/terminals/shared/run.ts";
import { seatPlaces, showSeat } from "../src/terminals/registry.ts";

setDefaultTimeout(20_000);

const TMUX = Bun.which("tmux");
const SCRIPT = Bun.which("script");
const BIN = "/Users/jow/.kiwi/tmux/tmux-3.8";
const AT = { socket: "/tmp/kiwi-501/c67909c5955f", pane: "%12" };

const dirs: string[] = [];
const temp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const ran = (status: number | null, stdout = "", stderr = ""): Ran => ({ status, stdout, stderr });

function opener(over: Partial<TerminalOpener> & { pane?: Ran; open?: Ran } = {}) {
  const runs: string[][] = [];
  const starts: string[][] = [];
  const files: Record<string, string> = {};
  const o: TerminalOpener = {
    platform: "darwin",
    env: {},
    which: () => null,
    run: async (argv) => {
      runs.push([...argv]);
      return argv[0] === "open" ? (over.open ?? ran(0)) : (over.pane ?? ran(0, `${AT.pane}\n`));
    },
    start: async (argv) => {
      starts.push([...argv]);
      return true;
    },
    write: (path, text) => {
      files[path] = text;
      return true;
    },
    ...over,
  };
  return { o, runs, starts, files };
}

describe("the command that shows an app-started agent in the person's own terminal (T428)", () => {
  test("is the tmux attach to that agent's pane, sized to the terminal it opens in, and copies as one shell line", () => {
    expect(attachArgv(BIN, AT)).toEqual([BIN, "-S", AT.socket, "attach", "-t", "%12", ";", "set", "-w", "window-size", "latest"]);
    expect(attachLine(attachArgv(BIN, AT))).toBe(`${BIN} -S ${AT.socket} attach -t %12 \\; set -w window-size latest`);
    expect(attachLine(attachArgv("/Users/Jo Doe/.kiwi/tmux/tmux-3.8", AT))).toStartWith("'/Users/Jo Doe/.kiwi/tmux/tmux-3.8' -S ");
  });

  test.skipIf(!TMUX || !SCRIPT)("run in a real terminal, it lands on the agent's window and the window takes the terminal's size", async () => {
    const socket = `/tmp/kiwi-attach-${process.pid}`;
    const log = join(temp("kiwi-attach-log-"), "client");
    const tmux = (...args: string[]) => spawnSync(TMUX!, ["-S", socket, "-f", "/dev/null", ...args], { encoding: "utf8" });
    try {
      tmux("new-session", "-d", "-s", "_kiwi", "-x", "80", "-y", "24", "sleep 60");
      tmux("new-window", "-d", "-t", "_kiwi", "sleep 60");
      const pane = tmux("list-panes", "-s", "-t", "_kiwi", "-F", "#{pane_id}").stdout.trim().split("\n").at(-1)!;
      tmux("resize-window", "-t", pane, "-x", "70", "-y", "20");
      const run = `stty cols 140 rows 45; ${attachLine(attachArgv(TMUX!, { socket, pane }))}`;
      const inner = process.platform === "darwin" ? 'script -q /dev/null sh -c "$1"' : 'script -qfc "$1" /dev/null';
      const client = Bun.spawn(["sh", "-c", `sleep 30 | ${inner} > "$0" 2>&1`, log, run], { stdin: "ignore", stdout: "ignore", stderr: "ignore", env: { ...process.env, TERM: "xterm-256color" } });
      let seen = "";
      for (let i = 0; i < 50 && !seen; i++) {
        await Bun.sleep(100);
        seen = tmux("list-clients", "-F", "#{window_id}").stdout.trim();
      }
      await Bun.sleep(300);
      const said = (await Bun.file(log).exists()) ? (await Bun.file(log).text()).slice(0, 500) : "";
      expect({ seen, said: seen ? "" : said }).toEqual({ seen: tmux("display-message", "-p", "-t", pane, "#{window_id}").stdout.trim(), said: "" });
      expect(tmux("display-message", "-p", "-t", pane, "#{window_width}x#{window_height}").stdout.trim()).toBe("140x44");
      client.kill();
    } finally {
      tmux("kill-server");
    }
  });
});

describe("Open in your terminal, for an agent in Channels' own tmux (T428)", () => {
  test("on a Mac it opens a .command file next to the socket that runs the attach, with whatever opens those", async () => {
    const t = opener();
    expect(await showHosted(AT, BIN, t.o)).toEqual({ ok: true });
    const script = "/tmp/kiwi-501/attach-12.command";
    expect(t.files).toEqual({ [script]: `#!/bin/sh\nexec ${attachLine(attachArgv(BIN, AT))}\n` });
    expect(t.runs).toEqual([
      [BIN, "-S", AT.socket, "display-message", "-p", "-t", "%12", "#{pane_id}"],
      ["open", script],
    ]);
  });

  test("a pane that's gone, or a tmux that isn't running, opens nothing and says it isn't running", async () => {
    for (const pane of [ran(1, "", "can't find pane: %12"), ran(1, "", "no server running on /tmp/kiwi-501/x"), ran(0, "%13\n")]) {
      const t = opener({ pane });
      expect(await showHosted(AT, BIN, t.o)).toEqual({ ok: false, why: "no-server" });
      expect(t.files).toEqual({});
      expect(t.runs).toHaveLength(1);
    }
    expect(await showHosted(AT, BIN, opener({ pane: ran(null, "", "ENOENT") }).o)).toEqual({ ok: false, why: "failed" });
  });

  test("when nothing opens the file, or it can't be written, it says so", async () => {
    expect(await showHosted(AT, BIN, opener({ open: ran(1) }).o)).toEqual({ ok: false, why: "no-app" });
    expect(await showHosted(AT, BIN, opener({ write: () => false }).o)).toEqual({ ok: false, why: "failed" });
  });

  test("on Linux it starts the person's terminal running the attach, their own $TERMINAL first", async () => {
    const has =
      (...bins: string[]) =>
      (bin: string) =>
        bins.includes(bin) ? `/usr/bin/${bin}` : null;
    expect(linuxTerminal({}, has("xterm", "konsole"))).toEqual(["konsole", "-e"]);
    expect(linuxTerminal({ TERMINAL: "ghostty" }, has("ghostty", "xterm"))).toEqual(["ghostty", "-e"]);
    expect(linuxTerminal({ TERMINAL: "gone" }, has("gnome-terminal"))).toEqual(["gnome-terminal", "--"]);
    expect(linuxTerminal({}, has())).toBeNull();
    const t = opener({ platform: "linux", which: has("gnome-terminal") });
    expect(await showHosted(AT, BIN, t.o)).toEqual({ ok: true });
    expect(t.starts).toEqual([["gnome-terminal", "--", ...attachArgv(BIN, AT)]]);
    expect(await showHosted(AT, BIN, opener({ platform: "linux" }).o)).toEqual({ ok: false, why: "no-app" });
    expect(await showHosted(AT, BIN, opener({ platform: "win32" }).o)).toEqual({ ok: false, why: "no-app" });
  });

  test("the app lists each hosted seat with its command, and Show opens only a seat this computer has", async () => {
    const pane = { socket: hostedSocket(temp("kiwi-hosted-")), pane: "%3" };
    const cfg: Config = {
      channels: { ch: { roomId: "room-1", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "r", code: "c" } },
      bindings: { "/work": [{ alias: "ch", as: "ana", tmux: pane }] },
    };
    const none = { manifests: [], load: () => Promise.reject(new Error("no plugins")) };
    const seat: PlacedSeat = { place: "hosted", alias: "ch", agent: "ana", room: "room-1", ...pane, attach: attachLine(attachArgv(BIN, pane)) };
    expect(await seatPlaces(cfg, none, BIN)).toEqual([seat]);
    expect(readPlacedSeat(JSON.parse(JSON.stringify(seat)))).toEqual(seat);
    const t = opener({ pane: ran(0, "%3\n") });
    expect(await showSeat(seat, cfg, none, { tmux: BIN, opener: t.o })).toEqual({ ok: true });
    expect(t.runs.at(-1)?.[0]).toBe("open");
    const other = opener();
    expect(await showSeat({ ...seat, pane: "%9" }, cfg, none, { tmux: BIN, opener: other.o })).toEqual({ ok: false, why: "failed" });
    expect(other.runs).toEqual([]);
  });

  test("a seat's command with a control character in it is dropped, not shown", () => {
    const seat: PlacedSeat = { place: "hosted", alias: "ch", agent: "ana", socket: "/tmp/kiwi-501/x", pane: "%3" };
    expect(readPlacedSeat({ ...seat, attach: "tmux attach\n rm -rf ~" })).toEqual(seat);
  });
});
