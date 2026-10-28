import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWakeVia, wakePath, wakeWords } from "@kiwi/core/wake.ts";
import { HOSTED_SESSION, HostedTmux, findTmux } from "../src/daemon/hosted-tmux.ts";
import { promptState, typeWake } from "../src/daemon/wake-typing.ts";
import { hostedPaneHere, howMessagesReachYou } from "../src/hooks/reach.ts";

const tmux = await findTmux();

describe("whether a hosted agent is at its input prompt", () => {
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
    const screen = ["Do you want to proceed? 1. Yes", ...Array.from({ length: 20 }, (_, i) => `line ${i}`), "> "].join("\n");
    expect(promptState(screen, screen)).toBe("ready");
  });
});

describe("the wake route for a hosted seat", () => {
  test("Gemini, Cursor, Grok and Kimi in its terminal are woken by typing into their hosted window", () => {
    for (const harness of ["gemini", "cursor", "grok", "kimi"] as const) expect(wakePath({ harness, hosted: "%4" }, false)).toEqual({ kind: "command", via: "hosted-typing", session: "%4" });
  });

  test("a harness with a wake route keeps it, a held seat still wakes nothing, and a seat outside Channels' tmux has no typing", () => {
    expect(wakePath({ harness: "claude", hosted: "%4" }, true)).toEqual({ kind: "hooks" });
    expect(wakePath({ harness: "kimi", hosted: "%4", served: true, harnessSession: "s" }, false)).toEqual({ kind: "command", via: "kimi-server", session: "s" });
    expect(wakePath({ harness: "gemini", hosted: "%4", held: true }, false).kind).toBe("none");
    expect(wakePath({ harness: "gemini" }, false).kind).toBe("none");
    expect(wakePath({ harness: "zcode", hosted: "%4" }, false).kind).toBe("none");
  });

  test("it has a name people read, and the agent is told not to run listen", () => {
    expect(isWakeVia("hosted-typing")).toBe(true);
    expect(wakeWords("hosted-typing")).toBe("typing into its window in Channels");
    expect(howMessagesReachYou("kiwi", true, { harness: "gemini" }, false, "%4")).toBe(
      "Kiwi wakes you in this session when a message for you arrives (typing into its window in Channels). Don't run listen.",
    );
    expect(howMessagesReachYou("kiwi", true, { harness: "gemini" }, false, undefined)).not.toContain("typing into");
  });

  test("an agent knows it's hosted from its tmux socket", () => {
    const uid = process.getuid?.() ?? 0;
    expect(hostedPaneHere({ TMUX: `/tmp/kiwi-${uid}/abc,123,0`, TMUX_PANE: "%7" })).toBe("%7");
    expect(hostedPaneHere({ TMUX: `/tmp/tmux-${uid}/default,123,0`, TMUX_PANE: "%7" })).toBeUndefined();
    expect(hostedPaneHere({})).toBeUndefined();
  });
});

describe("typing a wake into a hosted window", () => {
  const home = mkdtempSync(join(tmpdir(), "kiwi-wake-typing-"));
  const hosted = new HostedTmux(home);
  afterAll(async () => {
    await hosted.kill();
    rmSync(home, { recursive: true, force: true });
  });

  const window = async (script: string): Promise<string> => {
    await hosted.ensure();
    const r = await hosted.tmux(hosted.state()!, ["new-window", "-d", "-t", `=${HOSTED_SESSION}`, "-P", "-F", "#{pane_id}", "/bin/sh", "-c", script]);
    return r.stdout.trim();
  };
  const screenOf = (pane: string): string => hosted.pane(pane)?.screen() ?? "";
  const until = async (ok: () => boolean): Promise<void> => {
    for (let i = 0; i < 60 && !ok(); i++) await Bun.sleep(50);
  };

  test.if(!!tmux)("types the wake and presses Enter when the agent sits at its prompt", async () => {
    const pane = await window('printf "> "; read line; echo "got: $line"; exec sleep 60');
    await until(() => screenOf(pane).includes(">"));
    expect(await typeWake(hosted, pane, "New Kiwi messages for you", 200)).toEqual({ ok: true });
    await until(() => screenOf(pane).includes("got: New Kiwi messages for you"));
    expect(screenOf(pane)).toContain("got: New Kiwi messages for you");
  });

  test.if(!!tmux)("waits, to try again, while a turn runs, a question is up, the screen moves, or a person types", async () => {
    const busy = await window('printf "✻ Working… (esc to interrupt)\\n"; exec sleep 60');
    const asking = await window('printf "Do you want to proceed?\\n 1. Yes\\n 2. No\\n"; exec sleep 60');
    const moving = await window("while :; do date +%s%N; sleep 0.05; done");
    const typed = await window('printf "> "; exec sleep 60');
    await until(() => screenOf(busy).includes("Working") && screenOf(asking).includes("proceed"));
    expect(await typeWake(hosted, busy, "wake", 200)).toEqual({ ok: false, why: "it's in the middle of a turn", retry: true });
    expect(await typeWake(hosted, asking, "wake", 200)).toEqual({ ok: false, why: "it's asking a question on its screen", retry: true });
    expect(await typeWake(hosted, moving, "wake", 200)).toEqual({ ok: false, why: "its screen is still changing", retry: true });
    hosted.keys(typed, "half a sente");
    expect(await typeWake(hosted, typed, "wake", 200)).toEqual({ ok: false, why: "someone is typing in its terminal", retry: true });
  });

  test.if(!!tmux)("gives up on a window that's gone", async () => {
    expect(await typeWake(hosted, "%99999", "wake", 50)).toEqual({ ok: false, why: "its window in Channels is gone", retry: false });
  });
});
