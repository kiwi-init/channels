import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isWakeVia, wakePath, wakeWords } from "@kiwi/core/wake.ts";
import { promptState, typeWake } from "../src/daemon/wake-pane.ts";
import { howMessagesReachYou } from "../src/hooks/reach.ts";
import type { Pane } from "../src/tmux-pane.ts";

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
    expect(howMessagesReachYou("kiwi", true, { harness: "agy", session: "c" }, false, undefined)).toContain("Kiwi wakes it only in tmux");
  });
});

const deepcode = (name: string): string => readFileSync(join(import.meta.dir, "fixtures", "deepcode-screens", `${name}.txt`), "utf8");
const deepcodeState = (name: string) => promptState(deepcode(name), deepcode(name), "deepcode");

describe("Deep Code's own screens, as deepcode-cli 0.6.0 draws them: only a recognized empty prompt is ready", () => {
  test("its empty prompt after a finished or interrupted turn, with or without its default status line: ready", () => {
    for (const name of ["idle", "interrupted", "custom-status"]) expect(deepcodeState(name)).toBe("ready");
  });

  test("a turn in progress, thinking, running a command or quiet: busy", () => {
    for (const name of ["thinking", "process", "processing-quiet", "live-command", "live-thinking"]) expect(deepcodeState(name)).toBe("busy");
  });

  test("a permission prompt, a question, or a turn waiting for its person: asking", () => {
    for (const name of ["permission", "question", "waiting"]) expect(deepcodeState(name)).toBe("asking");
  });

  test("a half-typed prompt, on one line or several, is a draft", () => {
    for (const name of ["draft", "draft-multiline"]) expect(deepcodeState(name)).toBe("draft");
  });

  test("any screen it doesn't recognize as its empty prompt is not ready, even a still one", () => {
    expect(deepcodeState("unrecognized")).toBe("unknown");
    expect(deepcodeState("status-message")).toBe("busy");
    expect(promptState("> \n", "> \n", "deepcode")).toBe("unknown");
    expect(promptState("", "", "deepcode")).toBe("unknown");
    const busyFooter = deepcode("custom-status").replace(/enter send · .*$/m, "esc to stop the stream");
    expect(promptState(busyFooter, busyFooter, "deepcode")).not.toBe("ready");
    const unknownStatus = deepcode("idle").replace("status: completed", "status: compacting");
    expect(promptState(unknownStatus, unknownStatus, "deepcode")).toBe("unknown");
  });

  test("the same screens without the harness keep the generic reading", () => {
    expect(promptState(deepcode("draft"), deepcode("draft"))).toBe("ready");
    expect(promptState(deepcode("unrecognized"), deepcode("unrecognized"))).toBe("ready");
  });

  test("a screen still changing is moving", () => {
    expect(promptState(deepcode("thinking"), deepcode("idle"), "deepcode")).toBe("moving");
  });
});

const FOOTER_060 = /^enter send · .* \/ rich text · \/ commands · ctrl\+d exit$/m;
const FOOTER_070 = "enter send · shift+enter newline · @ files · ctrl+v image · / commands · ctrl+d exit";
const on070 = (name: string): string => deepcode(name).replace(FOOTER_060, FOOTER_070);
const state070 = (name: string) => promptState(on070(name), on070(name), "deepcode");

describe("Deep Code's screens as deepcode-cli 0.7.0 draws them, whose footer drops '/ rich text': the prompt's structure is what's recognized", () => {
  test("its empty prompt, captured from a 0.7.0 pane, is ready", () => {
    expect(deepcodeState("0.7.0-idle")).toBe("ready");
  });

  test("the 0.6.0 empty prompts with the 0.7.0 footer are ready too", () => {
    for (const name of ["idle", "interrupted", "custom-status", "draft", "draft-multiline", "waiting"]) expect(on070(name)).not.toBe(deepcode(name));
    for (const name of ["idle", "interrupted", "custom-status"]) expect(state070(name)).toBe("ready");
  });

  test("busy, asking and draft screens with the 0.7.0 footer are refused as on 0.6.0", () => {
    for (const name of ["thinking", "process", "processing-quiet", "live-command", "live-thinking", "status-message"]) expect(state070(name)).toBe("busy");
    for (const name of ["permission", "question", "waiting"]) expect(state070(name)).toBe("asking");
    for (const name of ["draft", "draft-multiline"]) expect(state070(name)).toBe("draft");
  });

  test("a still-changing screen, an unknown status and a screen that isn't Deep Code's are not ready", () => {
    expect(promptState(on070("thinking"), on070("idle"), "deepcode")).toBe("moving");
    const unknownStatus = on070("idle").replace("status: completed", "status: compacting");
    expect(promptState(unknownStatus, unknownStatus, "deepcode")).toBe("unknown");
    expect(state070("unrecognized")).toBe("unknown");
  });

  test("the footer must still start with 'enter send' and end with 'ctrl+d exit'", () => {
    for (const footer of ["shift+enter newline · @ files · / commands · ctrl+d exit", "enter send · shift+enter newline · @ files · / commands", "enter send · ctrl+d exit"]) {
      const screen = deepcode("idle").replace(FOOTER_060, footer);
      expect(promptState(screen, screen, "deepcode")).toBe("unknown");
    }
  });
});

describe("typing a wake into a Deep Code pane", () => {
  test("an empty prompt gets the prompt pasted and Enter pressed", async () => {
    const pane = fakePane([deepcode("idle"), deepcode("idle")]);
    expect(await typeWake(pane, "You have new messages", "deepcode", 0)).toEqual({ ok: true });
    expect(pane.typed).toEqual(["You have new messages"]);
    expect(pane.entered).toBe(1);
  });

  test("a draft is never typed over or submitted, and an unrecognized screen is never typed into", async () => {
    for (const [name, why] of [
      ["draft", "someone has started typing at its prompt"],
      ["draft-multiline", "someone has started typing at its prompt"],
      ["unrecognized", "its screen isn't an empty prompt Kiwi recognizes"],
      ["status-message", "it's in the middle of a turn"],
      ["thinking", "it's in the middle of a turn"],
      ["permission", "it's asking a question on its screen"],
      ["question", "it's asking a question on its screen"],
    ] as const) {
      const pane = fakePane([deepcode(name), deepcode(name)]);
      expect(await typeWake(pane, "wake", "deepcode", 0)).toEqual({ ok: false, why, retry: true });
      expect(pane.typed).toEqual([]);
      expect(pane.entered).toBe(0);
    }
  });
});

describe("the wake route for a Deep Code seat", () => {
  test("in tmux it's woken by typing into its pane, and status says so", () => {
    const path = wakePath({ harness: "deepcode", tmux: { pane: "%16" } }, false);
    expect(path).toEqual({ kind: "command", via: "tmux-typing", session: "%16" });
    expect(path.kind === "command" ? `wakes via ${wakeWords(path.via)}` : "").toBe("wakes via typing into its tmux pane");
  });

  test("outside tmux it can't be woken, and a seat whose harness is unknown still can't be woken in tmux", () => {
    const outside = wakePath({ harness: "deepcode" }, false);
    expect(outside.kind === "none" ? outside.why : "").toContain("only in tmux");
    expect(wakePath({ tmux: { pane: "%16" } }, false).kind).toBe("none");
    expect(wakePath({ harness: "deepcode", tmux: { pane: "%16" }, held: true }, false).kind).toBe("none");
  });
});
