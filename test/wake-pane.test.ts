import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isWakeVia, wakePath, wakeWords } from "@kiwi/core/wake.ts";
import { promptState, typeWake } from "../src/daemon/wake-pane.ts";
import { howMessagesReachYou } from "../src/hooks/reach.ts";
import type { Pane } from "../src/terminals/plugin.ts";

const screen = (name: string): string => readFileSync(join(import.meta.dir, "fixtures", "agy-screens", `${name}.txt`), "utf8");

function fakePane(screens: readonly string[]): Pane & { typed: string[]; entered: number } {
  let shown = 0;
  const pane = {
    typed: [] as string[],
    entered: 0,
    screen: () => screens[Math.min(shown++, screens.length - 1)] ?? null,
    type: (text: string) => {
      pane.typed.push(text);
      return true;
    },
    enter: () => {
      pane.entered++;
      return true;
    },
    erase: () => true,
  };
  return pane;
}

describe("whether an agent in a tmux pane is at its input prompt", () => {
  test("a still screen with no turn running and no question is ready", () => {
    expect(promptState("> \n", "> \n")).toBe("ready");
    expect(promptState("a\n> ", "a\n> b")).toBe("moving");
    expect(promptState(null, "> ")).toBe("gone");
    expect(promptState("> ", null)).toBe("gone");
  });

  test("a turn in progress is busy, whatever the harness calls its interrupt key", () => {
    for (const line of ["⠋ Thinking (esc to cancel, 4s)", "✻ Working… (esc to interrupt)", "Generating · ctrl+c to stop", "thinking..."]) expect(promptState(line, line)).toBe("busy");
  });

  test("a permission or trust question on screen is never answered by a wake", () => {
    for (const line of ["Do you want to proceed?\n❯ 1. Yes\n  2. No", "Allow once  Allow always  Deny", "Apply this change? (y/n)", "Trust this folder?"])
      expect(promptState(line, line)).toBe("asking");
  });

  test("only the bottom of the screen counts: an old question scrolled up doesn't hold a wake", () => {
    const old = ["Do you want to proceed? 1. Yes", ...Array.from({ length: 20 }, (_, i) => `line ${i}`), "> "].join("\n");
    expect(promptState(old, old)).toBe("ready");
  });
});

describe("Antigravity CLI's own screens, as agy 1.4.12 draws them", () => {
  test("idle at its prompt after a turn: ready", () => {
    expect(promptState(screen("idle"), screen("idle"), "agy")).toBe("ready");
  });

  test("running a command (esc to cancel): busy", () => {
    expect(promptState(screen("busy"), screen("busy"), "agy")).toBe("busy");
  });

  test("its folder trust question (↑/↓ Navigate · enter Confirm): asking", () => {
    expect(promptState(screen("trust"), screen("trust"), "agy")).toBe("asking");
  });

  test("a person's half-typed prompt is a draft, never typed over", () => {
    expect(promptState(screen("draft"), screen("draft"), "agy")).toBe("draft");
    expect(promptState(screen("draft"), screen("draft"))).toBe("ready");
  });

  test("the mode hint in its empty input isn't a draft", () => {
    const hinted = `${screen("idle")}\n> Auto mode: edits & safe commands auto-approved (shift+tab to cycle)`;
    expect(promptState(hinted, hinted, "agy")).toBe("ready");
  });
});

describe("typing a wake into a pane", () => {
  test("a ready agy gets the prompt pasted and Enter pressed", async () => {
    const pane = fakePane([screen("idle"), screen("idle")]);
    expect(await typeWake(pane, "You have new messages", "agy", 0)).toEqual({ ok: true });
    expect(pane.typed).toEqual(["You have new messages"]);
    expect(pane.entered).toBe(1);
  });

  test("busy, asking or a draft waits for a retry and types nothing", async () => {
    for (const [name, why] of [
      ["busy", "it's in the middle of a turn"],
      ["trust", "it's asking a question on its screen"],
      ["draft", "someone has started typing at its prompt"],
    ] as const) {
      const pane = fakePane([screen(name), screen(name)]);
      expect(await typeWake(pane, "wake", "agy", 0)).toEqual({ ok: false, why, retry: true });
      expect(pane.typed).toEqual([]);
    }
  });

  test("a screen still changing waits, and a gone pane gives up", async () => {
    const moving = fakePane([screen("busy"), screen("idle")]);
    expect(await typeWake(moving, "wake", "agy", 0)).toEqual({ ok: false, why: "its screen is still changing", retry: true });
    expect(await typeWake(null, "wake", "agy", 0)).toEqual({ ok: false, why: "its tmux pane is gone", retry: false });
  });
});

describe("the wake route for an agent in its own tmux pane", () => {
  test("Antigravity CLI and Gemini CLI in tmux are woken by typing into their pane", () => {
    for (const harness of ["agy", "gemini"] as const) expect(wakePath({ harness, tmux: { pane: "%4" } }, false)).toEqual({ kind: "command", via: "tmux-typing", session: "%4" });
  });

  test("outside tmux they still can't be woken, a held seat wakes nothing, and harnesses with a wake of their own keep it", () => {
    expect(wakePath({ harness: "agy" }, false).kind).toBe("none");
    expect(wakePath({ harness: "gemini" }, false).kind).toBe("none");
    expect(wakePath({ harness: "agy", tmux: { pane: "%4" }, held: true }, false).kind).toBe("none");
    expect(wakePath({ harness: "claude", tmux: { pane: "%4" } }, true)).toEqual({ kind: "hooks" });
    expect(wakePath({ harness: "codex", session: "t", tmux: { pane: "%4" } }, false)).toEqual({ kind: "command", via: "codex-queue", session: "t" });
    for (const harness of ["cursor", "grok", "kimi", "zcode"] as const) expect(wakePath({ harness, tmux: { pane: "%4" } }, false).kind).toBe("none");
  });

  test("it has a name people read, and an agy agent in tmux is told not to keep a listener running", () => {
    expect(isWakeVia("tmux-typing")).toBe(true);
    expect(wakeWords("tmux-typing")).toBe("typing into its tmux pane");
    expect(howMessagesReachYou("kiwi", true, { harness: "agy", session: "c" }, false, "%7")).toBe(
      "Kiwi wakes you in this session when a message for you arrives (typing into its tmux pane). Don't keep a listener running.",
    );
    expect(howMessagesReachYou("kiwi", true, { harness: "agy", session: "c" }, false, undefined)).toContain("run_command");
  });
});
