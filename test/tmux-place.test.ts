import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, updateConfig } from "../src/config.ts";
import { notePlace } from "../src/seats.ts";
import { tmuxPlaceFrom } from "../src/tmux-pane.ts";

const SOCKET = "/private/tmp/tmux-501/default";
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

  describe("on the seat", () => {
    const prevHome = process.env.KIWI_HOME;
    let folder = "";

    beforeEach(() => {
      process.env.KIWI_HOME = temp("kiwi-tmux-home-");
      folder = temp("kiwi-tmux-proj-");
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
      notePlace([seat], { TMUX: `${SOCKET},1,0`, TMUX_PANE: "%7" });
      expect(loadConfig().bindings?.[folder]).toEqual({ alias: "ch", as: "ana", tmux: { socket: SOCKET, pane: "%7" } });
      notePlace([{ ...seat, tmux: { socket: SOCKET, pane: "%7" } }], { TERM_PROGRAM: "ghostty" });
      expect(loadConfig().bindings?.[folder]).toEqual({ alias: "ch", as: "ana" });
    });
  });
});
