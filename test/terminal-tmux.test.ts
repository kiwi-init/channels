import { afterAll, afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, updateConfig, type SeatRecord } from "../src/config.ts";
import { paneOf } from "../src/hooks/rotate.ts";
import { notePlace } from "../src/seats.ts";
import type { StatusRecord } from "../src/terminals/plugin.ts";
import { helpersOn, locate, markerOf, marking } from "../src/terminals/registry.ts";
import { downloadTmuxHelpers, kiwiConf, kiwiConfPath, MARK_FORMAT, removeTmuxHelpers, sourceLine, tmuxConfigPath, tmuxConfigs, tmuxHelpersStatus } from "../src/terminals/tmux/helpers.ts";
import { tmuxPlaceFrom } from "../src/terminals/tmux/locate.ts";
import { markText, tmuxMarker } from "../src/terminals/tmux/mark.ts";
import { showPane } from "../src/terminals/tmux/show.ts";

setDefaultTimeout(20_000);

const TMUX = Bun.which("tmux");
const SCRIPT = Bun.which("script");
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

const question = (count: number): StatusRecord => ({ id: "kiwi/ch/ask", state: "blocked", kind: "question", count, msg: `${count} questions for a person in ch: ship the secret plan?` });
const review = (task: number, alias = "ch"): StatusRecord => ({ id: `kiwi/${alias}/T${task}`, state: "done", task, msg: `T${task} waits for review` });
const occurrences = (text: string, part: string): number => text.split(part).length - 1;

describe("where a seat runs in tmux", () => {
  test("TMUX and TMUX_PANE give the socket and the pane, stored apart from Rex and the terminal", () => {
    const env = { TMUX: `${SOCKET},4242,0`, TMUX_PANE: "%3", TERM_PROGRAM: "tmux", REX_SERVER: "unix:///s", REX_SESSION: "session:01a15963-bacc-7426-91e9-4d98757dcd0c" };
    expect(tmuxPlaceFrom(env)).toEqual({ tmux: { socket: SOCKET, pane: "%3" } });
    expect(locate(env)).toEqual({ tmux: { socket: SOCKET, pane: "%3" } });
    expect(paneOf(env)).toEqual({ socket: SOCKET, pane: "%3" });
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

describe("the mark tmux shows", () => {
  test("counts and task numbers only, never a message's words", () => {
    expect(markText([])).toBe("");
    expect(markText([question(2)])).toBe("2?");
    expect(markText([question(1), review(7), review(3)])).toBe("1? T3 T7");
    expect(markText([question(2), question(1), review(3), review(3, "other")])).toBe("3? T3");
    expect(markText([review(9), review(2), review(5), review(4), review(1)])).toBe("T1 T2 T4 +2");
    expect(
      markText([
        { ...review(0), msg: "T0 waits" },
        { id: "x", state: "done", task: -4, msg: "x" },
      ]),
    ).toBe("");
    expect(markText([question(2), review(7)])).not.toContain("secret");
  });

  test("a seat in tmux is marked by tmux, a Rex terminal by Rex, and only while their helpers are on", () => {
    const inTmux: SeatRecord = { alias: "ch", as: "ana", tmux: { socket: SOCKET, pane: "%1" } };
    const inRex: SeatRecord = { alias: "ch", as: "bo", term: { program: "rex" } };
    const elsewhere: SeatRecord = { alias: "ch", as: "cy", term: { program: "ghostty" } };
    expect(markerOf(inTmux, ["rex", "tmux"])).toBe("tmux");
    expect(markerOf(inTmux, ["rex"])).toBeNull();
    expect(markerOf(inRex, ["rex", "tmux"])).toBe("rex");
    expect(markerOf(inRex, ["tmux"])).toBeNull();
    expect(markerOf(elsewhere, ["rex", "tmux"])).toBeNull();
  });
});

describe("the tmux helpers' files", () => {
  test("the line goes in the config tmux reads last, or the one that already has it", () => {
    const home = temp("kiwi-tmux-home-");
    const dot = join(home, ".tmux.conf");
    const xdg = join(home, "xdg", "tmux", "tmux.conf");
    const config = join(home, ".config", "tmux", "tmux.conf");
    expect(tmuxConfigs({}, home)).toEqual([dot, config]);
    expect(tmuxConfigs({ XDG_CONFIG_HOME: join(home, "xdg") }, home)).toEqual([dot, xdg, config]);
    expect(tmuxConfigs({ KIWI_TMUX_CONF: "/elsewhere/tmux.conf", XDG_CONFIG_HOME: join(home, "xdg") }, home)).toEqual(["/elsewhere/tmux.conf"]);
    expect(tmuxConfigPath({}, home)).toBe(dot);
    writeFileSync(dot, "set -g mouse on\n");
    expect(tmuxConfigPath({}, home)).toBe(dot);
    mkdirSync(join(home, ".config", "tmux"), { recursive: true });
    writeFileSync(config, "set -g mouse on\n");
    expect(tmuxConfigPath({}, home)).toBe(config);
    writeFileSync(dot, `set -g mouse on\n${sourceLine(dot)}\n`);
    expect(tmuxConfigPath({}, home)).toBe(dot);
    expect(tmuxHelpersStatus({}, home)).toBe("on");
  });

  test("kiwi.tmux.conf appends the mark to both formats once, and binds prefix K only when it's free", () => {
    const conf = kiwiConf("'/Applications/My Kiwi.app/kiwi'");
    expect(conf).toContain(`set -ga window-status-format "${MARK_FORMAT}"`);
    expect(conf).toContain(`set -ga window-status-current-format "${MARK_FORMAT}"`);
    expect(conf).toContain('%if "#{==:#{m:*@kiwi*,#{window-status-format}},0}"');
    expect(conf).toContain(`if-shell -b "! tmux -S '#{socket_path}' list-keys -T prefix K >/dev/null 2>&1" {`);
    expect(conf).toContain(`bind-key -T prefix K run-shell -b "'/Applications/My Kiwi.app/kiwi' ${SHOW}"`);
    expect(kiwiConf(`'/a"b/$HOME/#x/kiwi'`)).toContain(`run-shell -b "'/a\\"b/\\$HOME/##x/kiwi' ${SHOW}"`);
  });

  test("Download writes the file and one marked line, again changes nothing, and Remove takes both back", async () => {
    const dir = temp("kiwi-tmux-conf-");
    const conf = join(dir, "tmux.conf");
    const own = 'set -g window-status-format "#I:#W mine"';
    writeFileSync(conf, own);
    const live = { tmux: "/nonexistent/tmux", sockets: [] };
    expect(await downloadTmuxHelpers("'/opt/kiwi'", live, conf)).toEqual({ conf, file: kiwiConfPath(conf), changed: true });
    expect(readFileSync(kiwiConfPath(conf), "utf8")).toBe(kiwiConf("'/opt/kiwi'"));
    expect(readFileSync(conf, "utf8")).toBe(`${own}\nsource-file -q "${join(dir, "kiwi.tmux.conf")}" # Kiwi\n`);
    expect((await downloadTmuxHelpers("'/opt/kiwi'", live, conf)).changed).toBe(false);
    expect(occurrences(readFileSync(conf, "utf8"), "# Kiwi")).toBe(1);
    expect(tmuxHelpersStatus({ KIWI_TMUX_CONF: conf })).toBe("on");
    await removeTmuxHelpers(live, [conf]);
    expect(readFileSync(conf, "utf8")).toBe(`${own}\n`);
    expect(existsSync(kiwiConfPath(conf))).toBe(false);
    expect(tmuxHelpersStatus({ KIWI_TMUX_CONF: conf })).toBe("off");
  });

  test("a config Kiwi made holds nothing after Remove, so Remove deletes it", async () => {
    const conf = join(temp("kiwi-tmux-conf-"), "fresh", "tmux.conf");
    const live = { tmux: "/nonexistent/tmux", sockets: [] };
    await downloadTmuxHelpers("'/opt/kiwi'", live, conf);
    expect(readFileSync(conf, "utf8")).toBe(`${sourceLine(conf)}\n`);
    await removeTmuxHelpers(live, [conf]);
    expect(existsSync(conf)).toBe(false);
  });

  test("tmux's helpers are on for the status watch exactly while the marked line is there", async () => {
    const prev = process.env.KIWI_TMUX_CONF;
    const conf = join(temp("kiwi-tmux-conf-"), "tmux.conf");
    process.env.KIWI_TMUX_CONF = conf;
    try {
      const live = { tmux: "/nonexistent/tmux", sockets: [] };
      expect(helpersOn("tmux", {})).toBe(false);
      expect(marking({ rex: "on" })).toEqual(["rex"]);
      await downloadTmuxHelpers("'/opt/kiwi'", live, conf);
      expect(helpersOn("tmux", {})).toBe(true);
      expect(marking({})).toEqual(["tmux"]);
      await removeTmuxHelpers(live, [conf]);
      expect(marking({})).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.KIWI_TMUX_CONF;
      else process.env.KIWI_TMUX_CONF = prev;
    }
  });
});

const CLEAN: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "TMUX" && e[0] !== "TMUX_PANE"));

interface Server {
  name: string;
  socket: string;
  tm(...args: string[]): { status: number; out: string };
}

const servers: string[] = [];
const clients: { kill(): void }[] = [];

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

function attach(server: Server, session: string, dir: string): { keys(text: string): void } {
  const fifo = join(dir, "keys");
  expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
  const fd = openSync(fifo, "r+");
  const script = process.platform === "darwin" ? 'script -q /dev/null "$1" -L "$2" attach -t "$3"' : 'script -qfc "$1 -L $2 attach -t $3" /dev/null';
  const client = Bun.spawn(["sh", "-c", `cat "$0" | ${script} >/dev/null 2>&1`, fifo, TMUX!, server.name, session], {
    env: { ...CLEAN, TERM: "xterm-256color" },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  clients.push({
    kill: () => {
      closeSync(fd);
      client.kill();
    },
  });
  return { keys: (text) => void writeSync(fd, text) };
}

async function until(check: () => boolean, ms = 5_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (check()) return true;
  return check();
}

const keyK = (server: Server): string => server.tm("list-keys", "-T", "prefix", "K").out;

function personConf(dir: string, lines: string[]): string {
  const conf = join(dir, "tmux.conf");
  writeFileSync(conf, `${lines.join("\n")}\n`);
  return conf;
}

describe.skipIf(!TMUX)("on a throwaway tmux server", () => {
  afterEach(() => {
    for (const client of clients.splice(0)) client.kill();
    for (const name of servers.splice(0)) tmuxIn(name, "kill-server");
  });

  afterAll(async () => {
    expect(await until(() => Bun.spawnSync(["pgrep", "-f", `tmux -L kiwi-test-${process.pid}-`]).exitCode !== 0)).toBe(true);
  });

  test("a server reading the person's config with Kiwi's line keeps their format, adds the mark once, and binds a free prefix K", async () => {
    const dir = temp("kiwi-tmux-live-");
    const conf = personConf(dir, ['set -g window-status-format "#I:#W mine"']);
    await downloadTmuxHelpers("'/opt/kiwi'", { tmux: TMUX!, sockets: [] }, conf);
    const server = startServer(conf);
    expect(server.tm("show-options", "-gv", "window-status-format").out).toBe(`#I:#W mine${MARK_FORMAT}`);
    const current = server.tm("show-options", "-gv", "window-status-current-format").out;
    expect(current.endsWith(MARK_FORMAT)).toBe(true);
    expect(await until(() => keyK(server).includes(SHOW))).toBe(true);
    server.tm("source-file", conf);
    server.tm("source-file", kiwiConfPath(conf));
    expect(server.tm("show-options", "-gv", "window-status-format").out).toBe(`#I:#W mine${MARK_FORMAT}`);
    expect(occurrences(server.tm("show-options", "-gv", "window-status-current-format").out, MARK_FORMAT)).toBe(1);
  });

  test("a prefix K the person bound stays theirs", async () => {
    const dir = temp("kiwi-tmux-live-");
    const conf = personConf(dir, ["bind-key -T prefix K display-message mine"]);
    await downloadTmuxHelpers("'/opt/kiwi'", { tmux: TMUX!, sockets: [] }, conf);
    const server = startServer(conf);
    server.tm("source-file", kiwiConfPath(conf));
    await Bun.sleep(1_000);
    expect(keyK(server)).toContain("display-message mine");
    expect(keyK(server)).not.toContain(SHOW);
  });

  test("the seat's window shows counts and task numbers, summed over the seats in it, follows a seat that moved, and clears", async () => {
    const dir = temp("kiwi-tmux-live-");
    const conf = personConf(dir, []);
    await downloadTmuxHelpers("'/opt/kiwi'", { tmux: TMUX!, sockets: [] }, conf);
    const server = startServer(conf);
    server.tm("new-window", "-d", "-t", "kiwi:", "sleep 86400");
    const [first, second] = server
      .tm("list-panes", "-s", "-t", "kiwi", "-F", "#{window_id} #{pane_id}")
      .out.split("\n")
      .map((l) => l.split(" ") as [string, string]);
    const mark = tmuxMarker(TMUX!);
    const option = (window: string): string => server.tm("show-options", "-wqv", "-t", window, "@kiwi").out;
    const ana: SeatRecord = { alias: "ch", as: "ana", tmux: { socket: server.socket, pane: first![1] } };
    const bo: SeatRecord = { alias: "other", as: "bo", tmux: { socket: server.socket, pane: first![1] } };
    expect(await mark(ana, [], [], [question(2), review(7)])).toBe(true);
    expect(option(first![0])).toBe("2? T7");
    expect(server.tm("display-message", "-p", "-t", first![0], "#{E:window-status-format}").out.endsWith(" 2? T7")).toBe(true);
    expect(await mark(bo, [], [], [review(3, "other")])).toBe(true);
    expect(option(first![0])).toBe("2? T3 T7");
    expect(await mark({ ...ana, tmux: { socket: server.socket, pane: second![1] } }, [], [], [question(2), review(7)])).toBe(true);
    expect(option(first![0])).toBe("T3");
    expect(option(second![0])).toBe("2? T7");
    expect(await mark(bo, [], [], [])).toBe(true);
    expect(option(first![0])).toBe("");
    expect(await mark({ ...ana, tmux: { socket: server.socket, pane: "%999" } }, [], [], [question(1)])).toBe(false);
    expect(await mark({ alias: "ch", as: "cy" }, [], [], [question(1)])).toBe(false);
  });

  test("Show selects the seat's window and pane, and says when the pane or the server is gone", async () => {
    const server = startServer(personConf(temp("kiwi-tmux-live-"), []));
    server.tm("new-window", "-d", "-t", "kiwi:", "sleep 86400");
    const target = server.tm("split-window", "-d", "-P", "-F", "#{pane_id}", "-t", "kiwi:1", "sleep 86400").out;
    expect(await showPane({ socket: server.socket, pane: target }, TMUX!)).toEqual({ ok: false, why: "no-app" });
    expect(server.tm("display-message", "-p", "-t", "kiwi", "#{window_index} #{pane_id}").out).toBe(`1 ${target}`);
    expect(await showPane({ socket: server.socket, pane: "%999" }, TMUX!)).toEqual({ ok: false, why: "failed" });
    expect(await showPane({ socket: `/tmp/kiwi-test-gone-${process.pid}`, pane: target }, TMUX!)).toEqual({ ok: false, why: "no-server" });
  });

  test.skipIf(!SCRIPT)("with someone attached, Show switches their client to the pane, and prefix K runs kiwi terminal show", async () => {
    const dir = temp("kiwi-tmux-live-");
    const bin = join(dir, "k i'wi #1", "kiwi");
    mkdirSync(join(dir, "k i'wi #1"));
    writeFileSync(bin, `#!/bin/sh\necho "$@" > '${join(dir, "ran")}'\n`);
    chmodSync(bin, 0o755);
    const conf = personConf(dir, []);
    await downloadTmuxHelpers(`'${bin.replace(/'/g, "'\\''")}'`, { tmux: TMUX!, sockets: [] }, conf);
    const server = startServer(conf);
    server.tm("new-session", "-d", "-s", "elsewhere", "sleep 86400");
    const target = server.tm("display-message", "-p", "-t", "elsewhere:", "#{pane_id}").out;
    const client = attach(server, "kiwi", dir);
    expect(await until(() => server.tm("list-clients", "-F", "#{session_name}").out === "kiwi")).toBe(true);
    expect(await showPane({ socket: server.socket, pane: target }, TMUX!)).toEqual({ ok: true });
    expect(server.tm("list-clients", "-F", "#{session_name} #{pane_id}").out).toBe(`elsewhere ${target}`);
    expect(await until(() => keyK(server).includes(SHOW))).toBe(true);
    client.keys("\x02K");
    expect(await until(() => existsSync(join(dir, "ran")))).toBe(true);
    expect(readFileSync(join(dir, "ran"), "utf8")).toBe(`${SHOW}\n`);
  });

  test("Download on a running server marks it at once, and Remove leaves no line, no file, no @kiwi and the person's formats and keys as they were", async () => {
    const dir = temp("kiwi-tmux-live-");
    const conf = personConf(dir, ['set -g window-status-format "#I:#W mine"', 'set -g window-status-current-format "[#I #W]"']);
    const server = startServer(conf);
    server.tm("new-window", "-d", "-t", "kiwi:", "sleep 86400");
    server.tm("new-session", "-d", "-s", "more", "sleep 86400");
    const before = { plain: server.tm("show-options", "-gv", "window-status-format").out, current: server.tm("show-options", "-gv", "window-status-current-format").out };
    const live = { tmux: TMUX!, sockets: [server.socket] };
    await downloadTmuxHelpers("'/opt/kiwi'", live, conf);
    expect(server.tm("show-options", "-gv", "window-status-format").out).toBe(`${before.plain}${MARK_FORMAT}`);
    expect(server.tm("show-options", "-gv", "window-status-current-format").out).toBe(`${before.current}${MARK_FORMAT}`);
    expect(await until(() => keyK(server).includes(SHOW))).toBe(true);
    const windows = server.tm("list-windows", "-a", "-F", "#{window_id}").out.split("\n");
    expect(windows.length).toBe(3);
    for (const window of windows) server.tm("set-option", "-w", "-t", window, "@kiwi", "1?");
    await removeTmuxHelpers(live, [conf]);
    expect(readFileSync(conf, "utf8")).not.toContain("# Kiwi");
    expect(existsSync(kiwiConfPath(conf))).toBe(false);
    for (const window of windows) expect(server.tm("show-options", "-wqv", "-t", window, "@kiwi").out).toBe("");
    expect(server.tm("show-options", "-gv", "window-status-format").out).toBe(before.plain);
    expect(server.tm("show-options", "-gv", "window-status-current-format").out).toBe(before.current);
    expect(keyK(server)).not.toContain(SHOW);
  });
});
