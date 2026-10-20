import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@kiwi/core/protocol.ts";
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts";
import { aliasSegment, askId, clearFrame, placeFrom, reviewId, rexActivity, rexInstance, rexProcess, rexScreen, statusFrame, takesStatus } from "../src/rex.ts";
import { installPalette, paletteInstalled, removePalette, rexConfigPath } from "../src/rex-palette.ts";
import { localRexSeats, showInRex } from "../src/rex-show.ts";
import { seatRecords } from "../src/status.ts";
import { startRexEvents } from "../src/rex-events.ts";

const roster: Roster = [
  { name: "jonatas", pk: "p", owner: true, at: 1, active: true, kind: "human" },
  { name: "ana", pk: "q", owner: false, at: 1, active: true },
];

const ask = (seq: number, from: string): Message => ({ v: 1, id: `m${seq}`, seq, rts: seq, sigOk: true, from, kind: "ask", body: "ship it?", to: ["jonatas"] }) as Message;

const asked = (...asks: Message[]): ChannelState => {
  const state = fold([], roster);
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
  test("a block's events refresh it, and child_exited marks it gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-events-"));
    const bin = join(dir, "rex");
    const block = "block:11a15963-bacc-7426-91e9-4d98757dcd0c";
    const session = "session:01a15963-bacc-7426-91e9-4d98757dcd0c";
    const lines = [
      { session_id: session, session_event: { event: { kind: "terminal.pwd_changed", payload: { block_id: block } } } },
      { session_id: session, session_event: { event: { kind: "terminal.child_exited", payload: { block_id: block } } } },
      { session_id: session, session_event: { event: { kind: "terminal.title_changed", payload: { block_id: "block:21a15963-bacc-7426-91e9-4d98757dcd0c" } } } },
    ];
    writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(lines[0])}' '${JSON.stringify(lines[1])}' '${JSON.stringify(lines[2])}'\nsleep 5\n`);
    chmodSync(bin, 0o755);
    const seen: [string, string, boolean][] = [];
    const watch = startRexEvents({ servers: () => [{ server: "studio", bin }], onChange: (server, id, gone) => seen.push([server, id, gone]), everyMs: 100 });
    await Bun.sleep(150);
    watch.stop();
    expect(seen).toEqual([
      ["studio", block, false],
      ["studio", block, true],
      ["studio", "block:21a15963-bacc-7426-91e9-4d98757dcd0c", false],
    ]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Rex as a reader", () => {
  test("the root record, processes, screen and instance id come back even when wrapped", () => {
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
    expect(rexActivity(place, bin)).toEqual({ state: "working", tool: "cargo test" });
    expect(rexProcess(place, bin)).toEqual({ foreground: 456, child: 123 });
    expect(rexScreen(place, bin)).toBe("the screen");
    expect(rexInstance(place, bin)).toBe("instance-1");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("the palette action", () => {
  test("Rex's config is REX_CONFIG, else XDG, else ~/.config", () => {
    expect(rexConfigPath({ REX_CONFIG: "/tmp/my.lua", XDG_CONFIG_HOME: "/tmp/xdg" }, "/home/me")).toBe("/tmp/my.lua");
    expect(rexConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg" }, "/home/me")).toBe("/tmp/xdg/rex/init.lua");
    expect(rexConfigPath({}, "/home/me")).toBe("/home/me/.config/rex/init.lua");
  });

  test("on writes the action and one marked line, twice is one line, and off takes both back", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-palette-"));
    const init = join(dir, "rex", "init.lua");
    expect(paletteInstalled(init)).toBe(false);
    installPalette(init);
    expect(paletteInstalled(init)).toBe(true);
    const lua = readFileSync(join(dir, "rex", "kiwi.lua"), "utf8");
    expect(lua).toContain('name = "kiwi_needs_you"');
    expect(lua).toContain('title = "Kiwi: Go to the seat that needs me"');
    expect(lua).toContain("record.state == state");
    expect(lua).toContain('ipairs({ "blocked", "done" })');
    expect(lua).toContain("table.sort(rows");
    const once = readFileSync(init, "utf8");
    expect(once).toBe('require("kiwi") -- Kiwi: go to the seat that needs me\n');
    installPalette(init);
    expect(readFileSync(init, "utf8")).toBe(once);
    rmSync(init);
    installPalette(init);
    rmSync(join(dir, "rex", "kiwi.lua"));
    writeFileSync(join(dir, "rex", "kiwi.lua"), "old");
    installPalette(init);
    expect(readFileSync(join(dir, "rex", "kiwi.lua"), "utf8")).toContain("kiwi_needs_you");
    expect(paletteInstalled(init)).toBe(true);
    expect(removePalette(init)).toBe(true);
    expect(existsSync(join(dir, "rex", "kiwi.lua"))).toBe(false);
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

  test("it focuses the block and switches the app's session; without an app client it says Remote Control", () => {
    const dir = mkdtempSync(join(tmpdir(), "kiwi-rex-show-"));
    const bin = join(dir, "rex");
    writeFileSync(
      bin,
      `#!/bin/sh
case "$*" in
  *client.list*) echo '{"clients":[{"client_id":"c1","info":{"kind":"app"}}]}' ;;
  *session.focus_block*) echo '{"revision":1}' ;;
  *session.select*) exit 0 ;;
  *) exit 1 ;;
esac
`,
    );
    chmodSync(bin, 0o755);
    expect(showInRex(place, bin)).toEqual({ ok: true });
    writeFileSync(bin, `#!/bin/sh\nexit 0\n`);
    expect(showInRex(place, bin)).toEqual({ ok: false, why: "remote-control" });
    writeFileSync(bin, `#!/bin/sh\nexit 4\n`);
    expect(showInRex(place, bin)).toEqual({ ok: false, why: "no-server" });
    expect(showInRex(place, null)).toEqual({ ok: false, why: "no-rex" });
    rmSync(dir, { recursive: true, force: true });
  });
});
