import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, updateConfig } from "../src/config.ts";
import { placeFrom } from "../src/seat-place.ts";
import { notePlace, placesIn } from "../src/seats.ts";
import { tmuxPlaceFrom } from "../src/tmux-pane.ts";

const SOCKET = "/private/tmp/tmux-501/default";
const TMUX = { TMUX: `${SOCKET},1,0`, TMUX_PANE: "%7", TERM_PROGRAM: "tmux" };
const REX = {
  server: "unix:///Users/ana/Library/Application%20Support/rex/server.sock",
  session: "session:01a1b0d0-a2bc-7b13-9924-96cb4e9e8dbd",
  block: "block:01a1b285-6117-76a7-b49e-34f424899158",
};
const IN_REX = { TERM_PROGRAM: "rex", REX_SERVER: REX.server, REX_SESSION: REX.session, REX_BLOCK: REX.block };
const made: string[] = [];
const temp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

describe("the tmux pane a seat runs in", () => {
  test("is read from tmux's own variables, and nothing else counts", () => {
    expect(tmuxPlaceFrom({ TMUX: `${SOCKET},1,0`, TMUX_PANE: "%7" })).toEqual({ tmux: { socket: SOCKET, pane: "%7" } });
    expect(tmuxPlaceFrom({ TMUX: `${SOCKET},1,0` })).toEqual({});
    expect(tmuxPlaceFrom({ TMUX: "relative/sock,1,0", TMUX_PANE: "%7" })).toEqual({});
    expect(tmuxPlaceFrom({ TMUX: `${SOCKET},1,0`, TMUX_PANE: "7; rm" })).toEqual({});
    expect(tmuxPlaceFrom({ TERM_PROGRAM: "ghostty" })).toEqual({});
  });
});

describe("where a seat sits: a tmux pane, a Rex block, or neither", () => {
  test("tmux gives its pane", () => {
    expect(placeFrom(TMUX)).toEqual({ tmux: { socket: SOCKET, pane: "%7" } });
  });

  test("Rex gives its server, session and block", () => {
    expect(placeFrom(IN_REX)).toEqual({ rex: REX });
  });

  test("tmux inside a Rex block is the tmux pane: the block only holds the tmux client", () => {
    expect(placeFrom({ ...IN_REX, ...TMUX })).toEqual({ tmux: { socket: SOCKET, pane: "%7" } });
    expect(placeFrom({ ...IN_REX, TMUX: `${SOCKET},1,0` })).toEqual({});
  });

  test("Rex variables count only in Rex itself, and only whole and well formed", () => {
    expect(placeFrom({ ...IN_REX, TERM_PROGRAM: "ghostty" })).toEqual({});
    expect(placeFrom({ ...IN_REX, REX_BLOCK: undefined })).toEqual({});
    expect(placeFrom({ ...IN_REX, REX_SERVER: "" })).toEqual({});
    expect(placeFrom({ ...IN_REX, REX_SERVER: "unix:///a b" })).toEqual({});
    expect(placeFrom({ ...IN_REX, REX_SESSION: "session:1; rm -rf ~" })).toEqual({});
    expect(placeFrom({ ...IN_REX, REX_BLOCK: REX.session })).toEqual({});
    expect(placeFrom({ ...IN_REX, REX_BLOCK: `${REX.block}\n` })).toEqual({ rex: REX });
  });

  test("anything else is nowhere", () => {
    expect(placeFrom({})).toEqual({});
    expect(placeFrom({ TERM_PROGRAM: "Apple_Terminal" })).toEqual({});
  });
});

describe("on the seat", () => {
  const prevHome = process.env.KIWI_HOME;
  let folder = "";

  beforeEach(() => {
    process.env.KIWI_HOME = temp("kiwi-place-home-");
    folder = temp("kiwi-place-proj-");
    updateConfig((c) => {
      c.bindings = { [folder]: { alias: "ch", as: "ana" } };
    });
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.KIWI_HOME;
    else process.env.KIWI_HOME = prevHome;
  });

  test("a hook in tmux stores the pane, and a hook outside takes it back", () => {
    const seat = { alias: "ch", as: "ana" };
    notePlace([seat], TMUX);
    expect(loadConfig().bindings?.[folder]).toEqual({ alias: "ch", as: "ana", tmux: { socket: SOCKET, pane: "%7" } });
    notePlace([{ ...seat, tmux: { socket: SOCKET, pane: "%7" } }], { TERM_PROGRAM: "ghostty" });
    expect(loadConfig().bindings?.[folder]).toEqual({ alias: "ch", as: "ana" });
  });

  test("a hook in Rex stores the block; moving to tmux swaps it for the pane", () => {
    const seat = { alias: "ch", as: "ana" };
    notePlace([seat], IN_REX);
    expect(loadConfig().bindings?.[folder]).toEqual({ alias: "ch", as: "ana", rex: REX });
    notePlace([{ ...seat, rex: REX }], TMUX);
    expect(loadConfig().bindings?.[folder]).toEqual({ alias: "ch", as: "ana", tmux: { socket: SOCKET, pane: "%7" } });
    notePlace([{ ...seat, tmux: { socket: SOCKET, pane: "%7" } }], IN_REX);
    expect(loadConfig().bindings?.[folder]).toEqual({ alias: "ch", as: "ana", rex: REX });
  });

  test("the channel's places name each seat once, from its latest binding, and skip seats that sit nowhere", () => {
    const other = temp("kiwi-place-other-");
    updateConfig((c) => {
      c.bindings = {
        [folder]: [
          { alias: "ch", as: "ana", at: 1, rex: REX },
          { alias: "ch", as: "bo" },
          { alias: "elsewhere", as: "cy", tmux: { socket: SOCKET, pane: "%2" } },
        ],
        [other]: { alias: "ch", as: "ana", at: 2, seen: 5, pid: 4242, tmux: { socket: SOCKET, pane: "%7" } },
      };
    });
    expect([...placesIn(loadConfig(), "ch")]).toEqual([["ana", { place: { tmux: { socket: SOCKET, pane: "%7" } }, pid: 4242 }]]);
  });
});
