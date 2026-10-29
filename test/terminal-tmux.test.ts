import { afterAll, afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type Roster, type Task } from "@kiwi/core/state.ts";
import { loadConfig, updateConfig, type Config, type SeatRecord } from "../src/config.ts";
import { hostedSocket } from "../src/daemon/hosted-tmux.ts";
import { notePlace } from "../src/seats.ts";
import { showNeedsYou } from "../src/status.ts";
import type { ShowResult, TerminalId } from "../src/terminals/plugin.ts";
import { locate, markerOf, marking, showsIn } from "../src/terminals/registry.ts";
import { dropTmuxHelpers, forgetTmuxHelpers, liveSockets, MARK_FORMAT, sourceLine } from "../src/terminals/tmux/leftovers.ts";
import { tmuxPlaceFrom } from "../src/terminals/tmux/locate.ts";
import { hostedSeats } from "../src/terminals/tmux/seats.ts";

setDefaultTimeout(20_000);

const TMUX = Bun.which("tmux");
const SHOW = "terminal show --needs-you";
const SOCKET = "/private/tmp/tmux-501/default";

const dirs: string[] = [];
const temp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const REX_PLACE = { server: "studio", session: "session:01a15963-bacc-7426-91e9-4d98757dcd0c", block: "block:11a15963-bacc-7426-91e9-4d98757dcd0c" };

describe("where a seat runs in tmux", () => {
  test("TMUX and TMUX_PANE give the socket and the pane, stored apart from Rex and the terminal", () => {
    const env = { TMUX: `${SOCKET},4242,0`, TMUX_PANE: "%3", TERM_PROGRAM: "tmux", REX_SERVER: "unix:///s", REX_SESSION: "session:01a15963-bacc-7426-91e9-4d98757dcd0c" };
    expect(tmuxPlaceFrom(env)).toEqual({ tmux: { socket: SOCKET, pane: "%3" } });
    expect(locate(env)).toEqual({ tmux: { socket: SOCKET, pane: "%3" } });
    expect(locate({ TERM_PROGRAM: "ghostty" })).toEqual({ term: { program: "ghostty" } });
  });

  test("junk in either variable records no tmux place", () => {
    for (const env of [
      { TMUX_PANE: "%3" },
      { TMUX: `${SOCKET},1,0` },
      { TMUX: `${SOCKET},1,0`, TMUX_PANE: "3" },
      { TMUX: `${SOCKET},1,0`, TMUX_PANE: "%x" },
      { TMUX: `${SOCKET},1,0`, TMUX_PANE: "%3; rm -rf ~" },
      { TMUX: `${SOCKET},1,0`, TMUX_PANE: "%12345678901" },
      { TMUX: "relative/socket,1,0", TMUX_PANE: "%3" },
      { TMUX: "/tmp/a\nb,1,0", TMUX_PANE: "%3" },
      { TMUX: ",1,0", TMUX_PANE: "%3" },
    ]) {
      expect(tmuxPlaceFrom(env)).toEqual({});
      expect(locate(env).tmux).toBeUndefined();
    }
  });

  describe("on the seat record", () => {
    const prevHome = process.env.KIWI_HOME;
    let folder = "";

    beforeEach(() => {
      process.env.KIWI_HOME = temp("kiwi-tmux-home-");
      folder = temp("kiwi-tmux-proj-");
      updateConfig((c) => {
        c.bindings = { [folder]: { alias: "ch", as: "ana", rex: { server: "studio", session: "session:01a15963-bacc-7426-91e9-4d98757dcd0c", block: "block:11a15963-bacc-7426-91e9-4d98757dcd0c" } } };
      });
    });

    afterEach(() => {
      if (prevHome === undefined) delete process.env.KIWI_HOME;
      else process.env.KIWI_HOME = prevHome;
    });

    test("a hook in tmux stores the pane where Rex's place was, and a hook outside takes it back", () => {
      const seat = { alias: "ch", as: "ana" };
      notePlace([seat], { TMUX: `${SOCKET},1,0`, TMUX_PANE: "%7" });
      expect(loadConfig().bindings?.[folder]).toEqual({ alias: "ch", as: "ana", tmux: { socket: SOCKET, pane: "%7" } });
      notePlace([seat], { TERM_PROGRAM: "ghostty" });
      expect(loadConfig().bindings?.[folder]).toEqual({ alias: "ch", as: "ana", term: { program: "ghostty" } });
    });
  });
});

describe("marks and Show", () => {
  test("only Rex marks a seat and shows it, and only while its helpers are on: a seat in tmux is neither", () => {
    const inTmux: SeatRecord = { alias: "ch", as: "ana", tmux: { socket: SOCKET, pane: "%1" } };
    const rex: SeatRecord = { alias: "ch", as: "bo", term: { program: "rex" }, rex: REX_PLACE };
    const on: Config = { channels: {}, terminals: { helpers: { rex: "on", tmux: "on" } } };
    expect(marking({})).toEqual([]);
    expect(marking(on)).toEqual(["rex"]);
    expect([markerOf(inTmux, ["rex"]), markerOf(rex, ["rex"]), markerOf(rex, [])]).toEqual([null, "rex", null]);
    expect([showsIn(inTmux, on), showsIn(rex, on), showsIn(rex, {}), showsIn({ term: { program: "ghostty" } }, on)]).toEqual([null, "rex", null, null]);
  });

  test("Channels lists the seats in its own tmux, once each, matched to their channel, and none from the person's tmux", () => {
    const hostedPane = { socket: hostedSocket(temp("kiwi-hosted-")), pane: "%3" };
    const cfg: Config = {
      channels: { ch: { roomId: "room-1", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "r", code: "c" } },
      bindings: {
        "/work": [
          { alias: "ch", as: "ana", tmux: hostedPane },
          { alias: "ch", as: "bo", tmux: { socket: SOCKET, pane: "%4" } },
        ],
        "/other": [{ alias: "ch", as: "ana", tmux: hostedPane }],
      },
    };
    expect(hostedSeats(cfg)).toEqual([{ alias: "ch", agent: "ana", room: "room-1", ...hostedPane }]);
  });
});

const roster: Roster = ["jonatas", "ana", "bo", "cy", "dan", "zed"].map((name) => ({
  name,
  pk: name,
  owner: name === "jonatas",
  at: 1,
  active: true,
  ...(name === "jonatas" ? { kind: "human" as const } : {}),
}));
const asking = (seq: number, from: string, at: number, to = "jonatas"): Message =>
  ({ v: 1, id: `m${seq}`, seq, ts: at, rts: at, sigOk: true, from, kind: "ask", body: "ship the secret plan?", to: [to], holds: [1000] }) as Message;
const waitingReview = (id: number, owner: string, at: number): Task => ({
  id,
  title: `task ${id}`,
  state: "review",
  owner,
  createdBy: owner,
  createdAt: 1,
  updatedAt: at,
  notes: [],
  workedBy: [owner],
  rounds: [{ n: 1, by: owner, seq: id, ts: at, result: { kind: "open" } }],
});

function board(asks: Message[], tasks: Task[] = []): ChannelState {
  const state = fold([], roster);
  state.askHeads.set(1000, { id: 1000, by: "jonatas", words: "ship the plan", at: 1 });
  state.openAsks.push(...asks);
  for (const task of tasks) state.tasks.set(task.id, task);
  return state;
}

const inRex = (block: string): Pick<SeatRecord, "term" | "rex"> => ({ term: { program: "rex" }, rex: { ...REX_PLACE, block: `block:${block}1a15963-bacc-7426-91e9-4d98757dcd0c` } });

function seated(helpers: Partial<Record<"rex", "on" | "off">>): Config {
  return {
    channels: {},
    terminals: { helpers },
    bindings: {
      "/w/ana": { alias: "ch", as: "ana", ...inRex("2") },
      "/w/bo": { alias: "ch", as: "bo", ...inRex("1") },
      "/w/cy": { alias: "ch", as: "cy", term: { program: "ghostty" } },
      "/w/dan": { alias: "other", as: "dan", ...inRex("3") },
      "/w/eve": { alias: "other", as: "eve", tmux: { socket: SOCKET, pane: "%2" } },
    },
  };
}

function needsYou(states: Record<string, ChannelState>, fails: Record<string, Extract<ShowResult, { ok: false }>["why"]> = {}) {
  const read: string[] = [];
  const shown: [TerminalId, string][] = [];
  return {
    read,
    shown,
    run: (cfg: Config) =>
      showNeedsYou(
        cfg,
        async (alias, agent) => {
          read.push(`${alias}/${agent}`);
          return states[alias] ?? null;
        },
        async (by, record) => {
          shown.push([by, record.as]);
          const why = fails[record.as];
          return why ? { ok: false, why } : { ok: true };
        },
      ),
  };
}

describe("kiwi terminal show --needs-you", () => {
  test("the oldest question for a person wins over any task waiting for review, among the seats a plugin can show", async () => {
    const states = { ch: board([asking(1, "ana", 50), asking(2, "bo", 20), asking(3, "cy", 10)], [waitingReview(7, "ana", 5)]), other: board([asking(1, "dan", 30)]) };
    const rex = needsYou(states);
    expect(await rex.run(seated({ rex: "on" }))).toEqual({ shown: { alias: "ch", agent: "bo", question: true, at: 20 } });
    expect(rex.shown).toEqual([["rex", "bo"]]);
    expect(rex.read).toEqual(["ch/ana", "other/dan"]);
  });

  test("with no question, the task waiting longest for review; a seat that can't be shown gives way to the next", async () => {
    const states = { ch: board([], [waitingReview(7, "ana", 40), waitingReview(3, "ana", 60)]), other: board([], [waitingReview(9, "dan", 20)]) };
    const gone = needsYou(states, { dan: "failed" });
    expect(await gone.run(seated({ rex: "on" }))).toEqual({ shown: { alias: "ch", agent: "ana", question: false, at: 40 } });
    expect(gone.shown).toEqual([
      ["rex", "dan"],
      ["rex", "ana"],
    ]);
    const detached = needsYou(states, { dan: "no-app", ana: "no-app" });
    expect(await detached.run(seated({ rex: "on" }))).toEqual({ shown: null, seats: 3, failed: { waiting: { alias: "other", agent: "dan", question: false, at: 20 }, why: "no-app" } });
  });

  test("a question to another agent, someone else's, or work not in review shows nothing, and with no helpers on no channel is read", async () => {
    const doing: Task = { ...waitingReview(4, "ana", 1), state: "doing" };
    const quiet = needsYou({ ch: board([asking(1, "ana", 5, "bo"), asking(2, "zed", 1)], [doing]) });
    expect(await quiet.run(seated({ rex: "on" }))).toEqual({ shown: null, seats: 3, failed: null });
    expect(quiet.shown).toEqual([]);
    const off = needsYou({ ch: board([asking(1, "ana", 5)]) });
    expect(await off.run(seated({}))).toEqual({ shown: null, seats: 0, failed: null });
    expect(off.read).toEqual([]);
  });
});

const OLD_KIWI_CONF = [
  ...["window-status-format", "window-status-current-format"].map((f) => `%if "#{==:#{m:*@kiwi*,#{${f}}},0}"\nset -ga ${f} "${MARK_FORMAT}"\n%endif`),
  `if-shell -b "! tmux -S '#{socket_path}' list-keys -T prefix K >/dev/null 2>&1" {\n  bind-key -T prefix K run-shell -b "'/opt/kiwi' ${SHOW}"\n}`,
  "",
].join("\n");

function withOldHelpers(dir: string, lines: string[]): string {
  const conf = join(dir, "tmux.conf");
  writeFileSync(join(dir, "kiwi.tmux.conf"), OLD_KIWI_CONF);
  writeFileSync(conf, `${[...lines, sourceLine(conf)].join("\n")}\n`);
  return conf;
}

describe("the tmux helpers an older Kiwi downloaded", () => {
  const prevHome = process.env.KIWI_HOME;
  afterEach(() => {
    if (prevHome === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = prevHome;
  });
  const away = (conf: string) => ({ KIWI_TMUX_CONF: conf, TMUX_TMPDIR: temp("kiwi-tmux-none-") });

  test("go once: the file and the person's line, and the switch from the config, the rest of it kept", async () => {
    const dir = temp("kiwi-tmux-old-");
    const conf = withOldHelpers(dir, ["set -g mouse on"]);
    process.env.KIWI_HOME = temp("kiwi-tmux-home-");
    updateConfig((c) => {
      c.terminals = { helpers: { rex: "on", tmux: "on" } };
    });
    expect(await dropTmuxHelpers(away(conf), null)).toBe(true);
    expect(readFileSync(conf, "utf8")).toBe("set -g mouse on\n");
    expect(existsSync(join(dir, "kiwi.tmux.conf"))).toBe(false);
    expect(loadConfig().terminals).toEqual({ helpers: { rex: "on" } });
    expect(await dropTmuxHelpers(away(conf), null)).toBe(false);
  });

  test("a config that held only Kiwi's line is removed, and a computer that never had them is left alone", async () => {
    const dir = temp("kiwi-tmux-old-");
    const conf = withOldHelpers(dir, []);
    await forgetTmuxHelpers({ tmux: null, sockets: [] }, [conf]);
    expect(existsSync(conf)).toBe(false);
    const untouched = temp("kiwi-tmux-old-");
    const mine = join(untouched, "tmux.conf");
    writeFileSync(mine, "set -g mouse on\n");
    process.env.KIWI_HOME = temp("kiwi-tmux-home-");
    expect(await dropTmuxHelpers(away(mine), null)).toBe(false);
    expect(readFileSync(mine, "utf8")).toBe("set -g mouse on\n");
  });
});

const CLEAN: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !["TMUX", "TMUX_PANE", "TMUX_TMPDIR"].includes(e[0])));

interface Server {
  name: string;
  socket: string;
  tm(...args: string[]): { status: number; out: string };
}

const servers: string[] = [];

function tmuxIn(name: string, ...args: string[]): { status: number; out: string } {
  const r = Bun.spawnSync([TMUX!, "-L", name, ...args], { env: CLEAN, stdout: "pipe", stderr: "pipe" });
  return { status: r.exitCode, out: r.stdout.toString().replace(/\n$/, "") };
}

function startServer(conf: string): Server {
  const name = `kiwi-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  servers.push(name);
  expect(tmuxIn(name, "-f", conf, "new-session", "-d", "-s", "kiwi", "-x", "80", "-y", "24", "sleep 86400").status).toBe(0);
  const socket = tmuxIn(name, "display-message", "-p", "-t", "kiwi:", "#{socket_path}").out;
  expect(socket.startsWith("/")).toBe(true);
  return { name, socket, tm: (...args) => tmuxIn(name, ...args) };
}

async function until(check: () => boolean, ms = 5_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (check()) return true;
  return check();
}

const keyK = (server: Server): string => server.tm("list-keys", "-T", "prefix", "K").out;

describe.skipIf(!TMUX)("on a throwaway tmux server", () => {
  afterEach(() => {
    for (const name of servers.splice(0)) tmuxIn(name, "kill-server");
  });

  afterAll(async () => {
    expect(await until(() => Bun.spawnSync(["pgrep", "-f", `tmux -L kiwi-test-${process.pid}-`]).exitCode !== 0)).toBe(true);
  });

  test("a running server with the old helpers loses its marks, Kiwi's part of its formats and prefix K, and keeps the person's", async () => {
    const dir = temp("kiwi-tmux-live-");
    const conf = withOldHelpers(dir, ['set -g window-status-format "#I:#W mine"', 'set -g window-status-current-format "[#I #W]"']);
    const server = startServer(conf);
    server.tm("new-window", "-d", "-t", "kiwi:", "sleep 86400");
    server.tm("new-session", "-d", "-s", "more", "sleep 86400");
    expect(server.tm("show-options", "-gv", "window-status-format").out).toBe(`#I:#W mine${MARK_FORMAT}`);
    expect(await until(() => keyK(server).includes(SHOW))).toBe(true);
    const windows = server.tm("list-windows", "-a", "-F", "#{window_id}").out.split("\n");
    expect(windows.length).toBe(3);
    for (const window of windows) server.tm("set-option", "-w", "-t", window, "@kiwi", "1?");
    const sockets = liveSockets([server.socket.replace(/^\/private\//, "/")], { TMUX_TMPDIR: temp("kiwi-tmux-none-") });
    expect(sockets).toEqual([server.socket]);
    await forgetTmuxHelpers({ tmux: TMUX!, sockets }, [conf]);
    expect(readFileSync(conf, "utf8")).not.toContain("# Kiwi");
    expect(existsSync(join(dir, "kiwi.tmux.conf"))).toBe(false);
    for (const window of windows) expect(server.tm("show-options", "-wqv", "-t", window, "@kiwi").out).toBe("");
    expect(server.tm("show-options", "-gv", "window-status-format").out).toBe("#I:#W mine");
    expect(server.tm("show-options", "-gv", "window-status-current-format").out).toBe("[#I #W]");
    expect(keyK(server)).not.toContain(SHOW);
  });

  test("a prefix K the person bound stays theirs", async () => {
    const dir = temp("kiwi-tmux-live-");
    const conf = withOldHelpers(dir, ["bind-key -T prefix K display-message mine"]);
    const server = startServer(conf);
    await forgetTmuxHelpers({ tmux: TMUX!, sockets: [server.socket] }, [conf]);
    expect(keyK(server)).toContain("display-message mine");
  });
});
