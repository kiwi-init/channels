import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts";
import { rexActivity, rexInstance, rexProcess, rexScreen } from "../src/terminals/rex/api.ts";
import { installPalette, paletteInstalled, removePalette, rexConfigPath } from "../src/terminals/rex/helpers.ts";
import { placeFrom } from "../src/terminals/rex/locate.ts";
import { localRexSeats, showInRex } from "../src/terminals/rex/show.ts";
import { aliasSegment, askId, clearFrame, reviewId, statusFrame, takesStatus } from "../src/terminals/shared/osc7501.ts";
import { foldStillFresh, seatRecords } from "../src/status.ts";
import { startRexEvents } from "../src/terminals/rex/watch.ts";
import { readsRex } from "../src/daemon/reach.ts";
import { readRexInto, type RexReadSeat } from "../src/daemon/rex-reads.ts";
import type { RexActivity } from "../src/terminals/plugin.ts";
import { terminalPlugin } from "../src/terminals/registry.ts";
import type { SeatRecord } from "../src/config.ts";

const roster: Roster = [
  { name: "jonatas", pk: "p", owner: true, at: 1, active: true, kind: "human" },
  { name: "ana", pk: "q", owner: false, at: 1, active: true },
];

const ask = (seq: number, from: string): Message => ({ v: 1, id: `m${seq}`, seq, rts: seq, sigOk: true, from, kind: "ask", body: "ship it?", to: ["jonatas"], holds: [1000] }) as Message;

const asked = (...asks: Message[]): ChannelState => {
  const state = fold([], roster);
  state.askHeads.set(1000, { id: 1000, by: "jonatas", words: "ship it", at: 1 });
  state.openAsks.push(...asks);
  return state;
};

describe("where a seat runs", () => {
  test("outside tmux, a Rex pane records the terminal and the ids", () => {
    const place = placeFrom({
      TERM_PROGRAM: "rex",
      TERM_PROGRAM_VERSION: "0.0.1792158932-g88fd41",
      REX_SERVER: "unix:///Users/jow/Library/Application%20Support/rex/server.sock",
      REX_SESSION: "session:01a15963-bacc-7426-91e9-4d98757dcd0c",
      REX_BLOCK: "block:11a15963-bacc-7426-91e9-4d98757dcd0c",
    });
    expect(place.term).toEqual({ program: "rex", version: "0.0.1792158932-g88fd41" });
    expect(place.rex).toEqual({
      server: "unix:///Users/jow/Library/Application%20Support/rex/server.sock",
      session: "session:01a15963-bacc-7426-91e9-4d98757dcd0c",
      block: "block:11a15963-bacc-7426-91e9-4d98757dcd0c",
    });
  });

  test("inside tmux nothing is recorded, and a bad id drops Rex but keeps the terminal", () => {
    expect(placeFrom({ TMUX: "/tmp/tmux,1,0", TERM_PROGRAM: "rex", REX_SERVER: "unix:///s", REX_SESSION: "session:x", REX_BLOCK: "block:y" })).toEqual({});
    const place = placeFrom({ TERM_PROGRAM: "rex", REX_SERVER: "unix:///s", REX_SESSION: "session:nope", REX_BLOCK: "block:y" });
    expect(place.rex).toBeUndefined();
    expect(place.term).toEqual({ program: "rex" });
  });

  test("any terminal outside tmux is recorded, Rex or not; no TERM_PROGRAM records nothing", () => {
    expect(placeFrom({ TERM_PROGRAM: "ghostty", TERM_PROGRAM_VERSION: "1.2.3" })).toEqual({ term: { program: "ghostty", version: "1.2.3" } });
    expect(placeFrom({ TERM_PROGRAM: "Apple_Terminal" })).toEqual({ term: { program: "Apple_Terminal" } });
    expect(placeFrom({ TERM_PROGRAM: "rex", REX_SERVER: "unix:///s" })).toEqual({ term: { program: "rex" } });
    expect(placeFrom({})).toEqual({});
  });
});

describe("which terminals take a status record", () => {
  test("Rex today, anything unknown or absent no", () => {
    expect(takesStatus({ program: "rex" })).toBe(true);
    expect(takesStatus({ program: "REX", version: "1" })).toBe(true);
    expect(takesStatus({ program: "ghostty" })).toBe(false);
    expect(takesStatus(undefined)).toBe(false);
  });
});

describe("the record Kiwi writes", () => {
  test("the id segment is cut to the protocol's set, with a fallback", () => {
    expect(aliasSegment("channels-explore")).toBe("channels-explore");
    expect(aliasSegment("a".repeat(40))).toBe("a".repeat(32));
    expect(aliasSegment("日本語")).toBe("ch");
    expect(aliasSegment("a/b c")).toBe("abc");
    expect(askId("channels-explore")).toBe("kiwi/channels-explore/ask");
    expect(reviewId("channels-explore", 7)).toBe("kiwi/channels-explore/T7");
  });

  test("a blocked record carries state, kind, app, id, title and a base64 msg, ended with ST", () => {
    const frame = statusFrame({ id: "kiwi/ch/ask", state: "blocked", kind: "question", msg: "2 questions for a person in ch" });
    expect(frame.startsWith("\x1b]7501;")).toBe(true);
    expect(frame.endsWith("\x1b\\")).toBe(true);
    expect(frame).toContain("state=blocked:kind=question:app=kiwi:id=kiwi/ch/ask:");
    expect(frame).toContain(`msg=${Buffer.from("2 questions for a person in ch", "utf8").toString("base64")}`);
    expect(frame).toContain(`title=${Buffer.from("Kiwi", "utf8").toString("base64")}`);
  });

  test("a done record has no kind, and a clear names the id it takes back", () => {
    expect(statusFrame({ id: "kiwi/ch/T7", state: "done", msg: "T7 waits for review" })).toContain("state=done:app=kiwi:id=kiwi/ch/T7:");
    expect(clearFrame("kiwi/ch")).toBe("\x1b]7501;state=clear:app=kiwi:id=kiwi/ch\x1b\\");
  });

  test("a question open to a person is blocked, and each task waiting for review is done", () => {
    const state = asked(ask(1, "ana"));
    expect(seatRecords(state, "ch", "ana").map((r) => ({ id: r.id, state: r.state, msg: r.msg }))).toEqual([{ id: "kiwi/ch/ask", state: "blocked", msg: "1 question for a person in ch" }]);
    const two = asked(ask(1, "ana"), ask(2, "ana"));
    expect(seatRecords(two, "ch", "ana")[0]?.msg).toBe("2 questions for a person in ch");
    const board = fold([], roster);
    board.tasks.set(7, { id: 7, title: "t", state: "review", owner: "ana", notes: [], rounds: [], workedBy: [], touched: {} } as never);
    board.tasks.set(3, { id: 3, title: "t", state: "review", owner: "ana", notes: [], rounds: [], workedBy: [], touched: {} } as never);
    board.tasks.set(9, { id: 9, title: "t", state: "doing", owner: "ana", notes: [], rounds: [], workedBy: [], touched: {} } as never);
    expect(seatRecords(board, "ch", "ana").map((r) => r.id)).toEqual(["kiwi/ch/T3", "kiwi/ch/T7"]);
  });

  test("another agent's question, and a task waiting on someone else, say nothing about this seat", () => {
    const state = asked(ask(1, "bo"));
    expect(seatRecords(state, "ch", "ana")).toEqual([]);
  });
});

describe("Rex events", () => {
  test("a block's events refresh it, child_exited and block_closed mark it gone, and a status message naming them does not", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-events-"));
    const bin = join(dir, "rex");
    const block = "block:11a15963-bacc-7426-91e9-4d98757dcd0c";
    const other = "block:21a15963-bacc-7426-91e9-4d98757dcd0c";
    const session = "session:01a15963-bacc-7426-91e9-4d98757dcd0c";
    const blockEvent = (id: string, name: string, payload: unknown) => ({
      type: "session_event",
      payload: { session_id: session, event: { type: "block_event", payload: { block_id: id, creator_name: "com.superlogical.terminal", name, payload } } },
    });
    const lines = [
      { type: "client_joined", payload: { client: { client_id: "client:01a15a45-4bf6-7d4e-80cb-afc8148f27d6" } } },
      blockEvent(block, "program_status_changed", { id: "", record: { state: "working", app: "claude-code", msg: "grep child_exited in the log" }, reason: "report" }),
      blockEvent(block, "child_exited", { exit_code: 0 }),
      blockEvent(other, "process_changed", { generation: 2, foreground: { pid: 38035, name: "login" } }),
      { type: "session_event", payload: { session_id: session, event: { type: "block_closed", payload: { block_id: other } } } },
    ];
    writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n${lines.map((l) => JSON.stringify(l)).join("\n")}\nEOF\nsleep 5\n`);
    chmodSync(bin, 0o755);
    const seen: [string, string, boolean][] = [];
    const watch = startRexEvents({ servers: () => [{ server: "studio", bin }], onChange: (server, id, gone) => seen.push([server, id, gone]), everyMs: 100 });
    for (const end = Date.now() + 10_000; seen.length < 4 && Date.now() < end;) await Bun.sleep(20);
    watch.stop();
    expect(seen).toEqual([
      ["studio", block, false],
      ["studio", block, true],
      ["studio", other, false],
      ["studio", other, true],
    ]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Rex status watch", () => {
  test("a seat's channel is folded again only when its head moved, or a minute went by", () => {
    expect(foldStillFresh({ head: 40, at: 1_000 }, 40, 30_000)).toBe(true);
    expect(foldStillFresh({ head: 40, at: 1_000 }, 41, 30_000)).toBe(false);
    expect(foldStillFresh({ head: 40, at: 1_000 }, 40, 61_000)).toBe(false);
    expect(foldStillFresh({ head: 40, at: 1_000 }, undefined, 2_000)).toBe(false);
    expect(foldStillFresh(null, 40, 2_000)).toBe(false);
  });
});

describe("Rex events from a dead server", () => {
  test("a server whose events stream keeps exiting is retried with a growing wait, not on every reconcile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-dead-"));
    const bin = join(dir, "rex");
    const starts = join(dir, "starts");
    writeFileSync(bin, `#!/bin/sh\necho start >> '${starts}'\nexit 1\n`);
    chmodSync(bin, 0o755);
    const watch = startRexEvents({ servers: () => [{ server: "dead", bin }], onChange: () => {}, everyMs: 50 });
    await Bun.sleep(1_600);
    watch.stop();
    const count = readFileSync(starts, "utf8").split("\n").filter(Boolean).length;
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(3);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Rex as a reader", () => {
  test("the root record, processes, screen and instance id come back even when wrapped", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-api-"));
    const bin = join(dir, "rex");
    writeFileSync(
      bin,
      `#!/bin/sh
case "$*" in
  *program_status*) echo '{"records":[{"id":"build","state":"done"},{"state":"working","msg":"cargo test"}]}' ;;
  *terminal.process*) echo '{"child":{"pid":123},"foreground":{"pid":456}}' ;;
  *terminal.format*) echo '{"content":"the screen"}' ;;
  *server.status*) echo '{"instance_id":"instance-1"}' ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(bin, 0o755);
    const place = { server: "studio", session: "session:01a15963-bacc-7426-91e9-4d98757dcd0c", block: "block:11a15963-bacc-7426-91e9-4d98757dcd0c" };
    expect(await rexActivity(place, bin)).toEqual({ state: "working", tool: "cargo test" });
    expect(rexProcess(place, bin)).toEqual({ foreground: 456, child: 123 });
    expect(rexScreen(place, bin)).toBe("the screen");
    expect(rexInstance(place, bin)).toBe("instance-1");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the daemon's Rex reads", () => {
  const place = { server: "studio", session: "session:01a15963-bacc-7426-91e9-4d98757dcd0c", block: "block:11a15963-bacc-7426-91e9-4d98757dcd0c" };

  test("a Rex that doesn't answer gives no activity at its deadline, and the daemon keeps running meanwhile", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-slow-"));
    const bin = join(dir, "rex");
    writeFileSync(bin, "#!/bin/sh\nsleep 10\n");
    chmodSync(bin, 0o755);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 20);
    const started = Date.now();
    expect(await rexActivity(place, bin, 300)).toBeNull();
    clearInterval(timer);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(ticks).toBeGreaterThan(5);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a result that changes on every read doesn't start the next read before the gap, nor while one is in flight", async () => {
    const seat: RexReadSeat = { rexBlock: place.block };
    let reads = 0;
    let changes = 0;
    const read = async (): Promise<RexActivity> => ({ state: "working", tool: `step ${++reads}` });
    const t0 = 1_000_000;
    const again = (at: number) => readRexInto(seat, place, read, changed, at, 1_000);
    const changed = () => {
      changes++;
      expect(again(t0 + 10)).toBe(false);
    };
    expect(again(t0)).toBe(true);
    expect(again(t0 + 1)).toBe(false);
    await Bun.sleep(10);
    expect([reads, changes]).toEqual([1, 1]);
    expect(seat.rexActivity).toEqual({ state: "working", tool: "step 1" });
    expect(again(t0 + 999)).toBe(false);
    expect(again(t0 + 1_000)).toBe(true);
    await Bun.sleep(10);
    expect([reads, changes]).toEqual([2, 2]);
  });

  test("an unchanged result, a failed read or a block that moved on doesn't refresh the seat", async () => {
    const seat: RexReadSeat = { rexBlock: place.block, rexActivity: { state: "idle" } };
    let changes = 0;
    readRexInto(
      seat,
      place,
      async () => ({ state: "idle" }),
      () => changes++,
      0,
      0,
    );
    await Bun.sleep(5);
    readRexInto(
      seat,
      place,
      async () => Promise.reject(new Error("rex died")),
      () => changes++,
      1,
      0,
    );
    await Bun.sleep(5);
    expect(seat.rexActivity).toBeNull();
    expect(changes).toBe(1);
    seat.rexBlock = "block:22a15963-bacc-7426-91e9-4d98757dcd0c";
    readRexInto(
      seat,
      place,
      async () => ({ state: "working" }),
      () => changes++,
      2,
      0,
    );
    await Bun.sleep(5);
    expect([changes, seat.rexActivity, seat.rexReading]).toEqual([1, null, false]);
  });

  test("only with the Rex helpers on, for a seat in Rex whose harness Kiwi can't read from its files", () => {
    const rex = place;
    const ON = { terminals: { helpers: { rex: "on" as const } } };
    const OFF = { terminals: { helpers: { rex: "off" as const } } };
    expect(readsRex(ON, { harness: "grok", rex } as SeatRecord)).toBe(true);
    expect(readsRex(ON, { rex } as SeatRecord)).toBe(true);
    expect(readsRex(OFF, { harness: "grok", rex } as SeatRecord)).toBe(false);
    expect(readsRex({}, { harness: "grok", rex } as SeatRecord)).toBe(false);
    expect(readsRex(ON, { harness: "grok" } as SeatRecord)).toBe(false);
    for (const harness of ["claude", "codex", "opencode"] as const) expect(readsRex(ON, { harness, rex } as SeatRecord)).toBe(false);
    expect(readsRex(ON, null)).toBe(false);
  });
});

describe("the palette action", () => {
  test("init.lua kept as a link into dotfiles stays a link with its mode, and gets the line through it, on and off", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-link-"));
    const dotfiles = join(dir, "dotfiles", "init.lua");
    mkdirSync(join(dir, "dotfiles"));
    mkdirSync(join(dir, "rex"));
    writeFileSync(dotfiles, "rex.theme('dark')\n", { mode: 0o644 });
    chmodSync(dotfiles, 0o644);
    const init = join(dir, "rex", "init.lua");
    symlinkSync(dotfiles, init);
    installPalette(init, "/opt/rex/rex");
    expect(lstatSync(init).isSymbolicLink()).toBe(true);
    expect(readFileSync(dotfiles, "utf8")).toBe("rex.theme('dark')\nrequire(\"kiwi\") -- Kiwi: go to the seat that needs me\n");
    expect(statSync(dotfiles).mode & 0o777).toBe(0o644);
    removePalette(init);
    expect(lstatSync(init).isSymbolicLink()).toBe(true);
    expect(readFileSync(dotfiles, "utf8")).toBe("rex.theme('dark')\n");
    expect(readdirSync(join(dir, "dotfiles"))).toEqual(["init.lua"]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("Rex's config is REX_CONFIG, else XDG, else ~/.config", () => {
    expect(rexConfigPath({ REX_CONFIG: "/tmp/my.lua", XDG_CONFIG_HOME: "/tmp/xdg" }, "/home/me")).toBe("/tmp/my.lua");
    expect(rexConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg" }, "/home/me")).toBe("/tmp/xdg/rex/init.lua");
    expect(rexConfigPath({}, "/home/me")).toBe("/home/me/.config/rex/init.lua");
  });

  test("on writes the action, its finder and one marked line, twice is one line, and off takes all three back", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-palette-"));
    const init = join(dir, "rex", "init.lua");
    const action = join(dir, "rex", "kiwi.lua");
    const find = join(dir, "rex", "kiwi-find.lua");
    expect(paletteInstalled(init)).toBe(false);
    expect(installPalette(init, "/opt/rex bin/rex").changed).toBe(true);
    expect(paletteInstalled(init)).toBe(true);
    const lua = readFileSync(action, "utf8");
    expect(lua).toContain('local rex_bin = "/opt/rex bin/rex"');
    expect(lua).toContain(`local find = ${JSON.stringify(find)}`);
    expect(lua).toContain('name = "kiwi_needs_you"');
    expect(lua).toContain('title = "Kiwi: Go to the seat that needs me"');
    expect(lua).toContain('keywords = "kiwi channels needs you seat question review"');
    expect(lua).toContain('rex.exec({ rex_bin, "do", find }, { timeout = 10 })');
    expect(lua).toContain('rex.client.queue("session.select", { session_id = row.session_id })');
    const finder = readFileSync(find, "utf8");
    expect(finder).toContain("rex.session.attach{ session_id = id }");
    expect(finder).toContain('record.app == "kiwi" and (state == "blocked" or state == "done")');
    expect(finder).toContain("at < held.at");
    expect(finder).toContain("found.blocked or found.done");
    expect(finder).toContain('rex.call("session.focus_block"');
    const once = readFileSync(init, "utf8");
    expect(once).toBe('require("kiwi") -- Kiwi: go to the seat that needs me\n');
    expect(installPalette(init, "/opt/rex bin/rex").changed).toBe(false);
    expect(readFileSync(init, "utf8")).toBe(once);
    rmSync(init);
    installPalette(init, "/opt/rex bin/rex");
    writeFileSync(action, "old");
    rmSync(find);
    expect(paletteInstalled(init)).toBe(false);
    expect(installPalette(init, "/opt/rex bin/rex").changed).toBe(true);
    expect(readFileSync(action, "utf8")).toContain("kiwi_needs_you");
    expect(paletteInstalled(init)).toBe(true);
    expect(removePalette(init)).toBe(true);
    expect(existsSync(action)).toBe(false);
    expect(existsSync(find)).toBe(false);
    expect(readFileSync(init, "utf8")).not.toContain("kiwi");
    rmSync(dir, { recursive: true, force: true });
  });

  test("a person's own init.lua keeps its lines and gets the one at the end", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-palette-"));
    const init = join(dir, "init.lua");
    writeFileSync(init, 'rex.bind("cmd+d", "pane.split")\nrequire("kiwi")');
    installPalette(init);
    const text = readFileSync(init, "utf8");
    expect(text.startsWith('rex.bind("cmd+d", "pane.split")\nrequire("kiwi")\n')).toBe(true);
    expect(text.match(/require\("kiwi"\)/g)?.length).toBe(2);
    removePalette(init);
    expect(readFileSync(init, "utf8")).toBe('rex.bind("cmd+d", "pane.split")\nrequire("kiwi")\n');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("show in Rex", () => {
  const place = { server: "studio", session: "session:01a15963-bacc-7426-91e9-4d98757dcd0c", block: "block:11a15963-bacc-7426-91e9-4d98757dcd0c" };

  test("only this computer's seats with a Rex pane, matched to their channel", () => {
    const seats = localRexSeats({
      channels: { ch: { roomId: "room-1", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "r", code: "c" } },
      bindings: {
        "/work": [
          { alias: "ch", as: "ana", rex: place },
          { alias: "ch", as: "bo" },
        ],
      },
    } as never);
    expect(seats).toEqual([{ alias: "ch", agent: "ana", room: "room-1", ...place }]);
  });

  test("it focuses the block and switches the app's session; it says when the app is closed or refuses actions", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-show-"));
    const bin = join(dir, "rex");
    const app =
      '{"clients":[{"client_id":"client:01a159a5-6af7-71b5-970b-7c20247caedb","principal":{"kind":"peer"}},{"client_id":"client:01a159a5-6b10-7720-b94c-3cf5bacf0ffc","info":{"kind":"app","platform":"macos","name":"Rex Beta"}}]}';
    const rex = (select: string) => `#!/bin/sh
case "$*" in
  *client.list*) echo '${app}' ;;
  *session.focus_block*) echo '{"revision":1}' ;;
  *session.select*) ${select} ;;
  *) exit 1 ;;
esac
`;
    writeFileSync(bin, rex("exit 0"));
    chmodSync(bin, 0o755);
    expect(showInRex(place, bin)).toEqual({ ok: true });
    writeFileSync(bin, rex(`echo 'Error: Rex.app is not accepting actions. Turn on Remote Control in its Settings under Rex Server.' >&2; exit 1`));
    expect(showInRex(place, bin)).toEqual({ ok: false, why: "remote-control" });
    writeFileSync(bin, `#!/bin/sh\necho '{"clients":[{"client_id":"c1","info":{"kind":"cli"}}]}'\n`);
    expect(showInRex(place, bin)).toEqual({ ok: false, why: "no-app" });
    writeFileSync(bin, `#!/bin/sh\nexit 4\n`);
    expect(showInRex(place, bin)).toEqual({ ok: false, why: "no-server" });
    expect(showInRex(place, null)).toEqual({ ok: false, why: "no-rex" });
    rmSync(dir, { recursive: true, force: true });
  });

  test("the Rex plugin lists the same seats, each marked as Rex's", async () => {
    const cfg = {
      channels: { ch: { roomId: "room-1", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "r", code: "c" } },
      bindings: {
        "/work": [
          { alias: "ch", as: "ana", rex: place },
          { alias: "ch", as: "bo" },
        ],
        "/other": { alias: "ch", as: "ana", rex: place },
      },
    } as never;
    const rex = await terminalPlugin("rex", { platform: "darwin", shell: "/bin/zsh", rex: null, tmux: null });
    expect(rex.seats?.(cfg)).toEqual(localRexSeats(cfg).map((seat) => ({ place: "rex", ...seat })));
    expect(rex.seats?.(cfg)).toEqual([{ place: "rex", alias: "ch", agent: "ana", room: "room-1", ...place }]);
  });

  test("kiwi terminal seats lists a Rex seat with the helpers on, and kiwi terminal show answers as kiwi rex show does", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-terminal-show-"));
    const home = join(dir, "kiwi");
    const bin = join(dir, "bin");
    mkdirSync(home);
    mkdirSync(bin);
    const app = '{"clients":[{"client_id":"client:01a159a5-6b10-7720-b94c-3cf5bacf0ffc","info":{"kind":"app","platform":"macos","name":"Rex Beta"}}]}';
    const rex = (select: string) =>
      `#!/bin/sh\ncase "$*" in\n  *client.list*) echo '${app}' ;;\n  *session.focus_block*) echo '{"revision":1}' ;;\n  *session.select*) ${select} ;;\n  *) exit 1 ;;\nesac\n`;
    writeFileSync(join(bin, "rex"), rex("exit 0"));
    chmodSync(join(bin, "rex"), 0o755);
    const config = (helpers: "on" | "off") =>
      writeFileSync(
        join(home, "config.json"),
        JSON.stringify({
          channels: { ch: { roomId: "room-1", ownerPk: "o", ownerXpk: "x", epoch: 0, keys: {}, relay: "r", code: "c" } },
          bindings: { "/work": { alias: "ch", as: "ana", rex: place } },
          rex: helpers,
        }),
      );
    const kiwi = async (...args: string[]): Promise<{ code: number; out: string }> => {
      const p = Bun.spawn(["bun", join(import.meta.dir, "../src/cli/main.ts"), ...args], {
        cwd: dir,
        env: { ...process.env, KIWI_HOME: home, KIWI_NO_HOOKS: "1", PATH: `${bin}:${process.env.PATH ?? ""}` },
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(p.stdout).text();
      return { code: await p.exited, out };
    };
    const seat = { place: "rex", alias: "ch", agent: "ana", room: "room-1", ...place };
    const byPlace = ["rex", "show", "--server", place.server, "--session", place.session, "--block", place.block];
    config("off");
    expect(await kiwi("terminal", "seats", "--json")).toEqual({ code: 0, out: "[]\n" });
    expect(await kiwi("terminal", "show", "--seat", JSON.stringify(seat))).toEqual({ code: 0, out: '{"ok":true}\n' });
    config("on");
    expect(await kiwi("terminal", "seats", "--json")).toEqual({ code: 0, out: `${JSON.stringify([seat])}\n` });
    const shown = await kiwi("terminal", "show", "--seat", JSON.stringify({ ...seat, alias: "kiwi", agent: "agent" }));
    expect(shown).toEqual({ code: 0, out: '{"ok":true}\n' });
    expect(await kiwi(...byPlace)).toEqual(shown);
    writeFileSync(join(bin, "rex"), rex(`echo 'Error: Rex.app is not accepting actions. Turn on Remote Control in its Settings under Rex Server.' >&2; exit 1`));
    expect(await kiwi("terminal", "show", "--seat", JSON.stringify(seat))).toEqual({ code: 0, out: '{"ok":false,"why":"remote-control"}\n' });
    expect(await kiwi(...byPlace)).toEqual({ code: 0, out: '{"ok":false,"why":"remote-control"}\n' });
    expect(await kiwi("terminal", "show", "--seat", JSON.stringify({ ...seat, block: "block:21a15963-bacc-7426-91e9-4d98757dcd0c" }))).toEqual({ code: 0, out: '{"ok":false,"why":"failed"}\n' });
    expect((await kiwi("terminal", "show", "--seat", "ch ana")).code).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  }, 30_000);
});

describe("Rex as a terminal plugin", () => {
  const place = { server: "studio", session: "session:01a15963-bacc-7426-91e9-4d98757dcd0c", block: "block:11a15963-bacc-7426-91e9-4d98757dcd0c" };

  test("its pane types into the block, presses Enter and erases there, and reads the screen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-pane-"));
    const bin = join(dir, "rex");
    const log = join(dir, "calls");
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\ncase "$*" in\n  *terminal.format*) echo '{"content":"the screen"}' ;;\nesac\n`);
    chmodSync(bin, 0o755);
    const rex = await terminalPlugin("rex", { platform: "darwin", shell: "/bin/zsh", rex: bin, tmux: null });
    const pane = rex.type?.({ rex: place });
    expect(pane?.type("/clear")).toBe(true);
    expect(pane?.enter()).toBe(true);
    expect(pane?.erase(2)).toBe(true);
    expect(pane?.screen()).toBe("the screen");
    const target = `-s ${place.session} -b ${place.block}`;
    expect(readFileSync(log, "utf8").trim().split("\n").slice(0, 3)).toEqual([
      `-S studio send ${target} /clear`,
      `-S studio send-key ${target} enter`,
      `-S studio send-key ${target} backspace backspace`,
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("a seat outside Rex gets no pane, no activity, and nothing to show", async () => {
    const rex = await terminalPlugin("rex", { platform: "darwin", shell: "/bin/zsh", rex: "/nonexistent/rex", tmux: null });
    expect(rex.type?.({ term: { program: "ghostty" } })).toBeNull();
    expect(await rex.activity?.({})).toBeNull();
    expect(await rex.show?.({})).toEqual({ ok: false, why: "failed" });
  });
});
