import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Config } from "../src/config.ts";
import { seatRecordFor } from "../src/daemon.ts";
import { howMessagesReachYou } from "../src/hooks.ts";
import { listenedPath, pullsWake, wakeArgv, wakePath, wakePrompt } from "@kiwi/core/wake.ts";
import { wakeHarness } from "./wake-harness.ts";

setDefaultTimeout(60_000);

const w = wakeHarness();
const { calls, until, readAll, seat, quiet, home, wakeLog, heard } = w;

describe("waking an agent in its own session", () => {
  test("a message for a Codex agent queues one turn in its thread, with a prompt that carries no message text", async () => {
    const readTo = await w.ownerCh.head();
    await w.ownerCh.send("the secret plan is in room 4", { to: ["claude"] });
    await until("a wake", () => calls().length === 1);
    expect(calls()[0]).toEqual(["codex", "queue", "--thread", "thread-1", "--message", wakePrompt("test", "claude")]);
    expect(readFileSync(wakeLog, "utf8")).not.toContain("secret");
    await until("the wake's record", async () => (await seat())?.wake.last !== null);
    expect((await seat())?.wake.last).toMatchObject({ via: "codex-queue", unread: 1, ok: true });
    await until("the wake log", () => existsSync(join(home, "wake.log")));
    expect(readFileSync(join(home, "wake.log"), "utf8")).toContain("\ttest\tclaude\tcodex-queue\t1\tok");
    expect(readFileSync(join(home, "wake.log"), "utf8").trimEnd().split("\t").slice(3)).toEqual(["codex-queue", "1", "ok", "", String(readTo)]);
    await until("presence saying how it wakes", () => heard.some((p) => p.pk === w.claudePk && p.wake === "codex-queue"));
  });

  test("a burst of messages is one wake, and none comes while the gap lasts", async () => {
    const before = await quiet();
    await w.ownerCh.send("one", { to: ["claude"] });
    await w.ownerCh.send("two", { to: ["claude"] });
    await w.ownerCh.send("three", { to: ["claude"] });
    await until("one wake", () => calls().length === before + 1);
    await Bun.sleep(1_000);
    expect(calls().length).toBe(before + 1);
  });

  test("an agent that has read since the message isn't woken", async () => {
    const before = await quiet();
    await w.ownerCh.send("read this before the wake", { to: ["claude"] });
    await readAll();
    await Bun.sleep(2_000);
    expect(calls().length).toBe(before);
  });

  test("a message that isn't for the agent doesn't wake it", async () => {
    const before = await quiet();
    await w.ownerCh.send("for someone else", { to: ["nobody"] });
    await Bun.sleep(2_000);
    expect(calls().length).toBe(before);
  });

  test("a message that arrives before the agent has read its last wake gets no wake of its own, and one after the agent read does", async () => {
    const before = await quiet();
    process.env.FAKE_WAKE_SLEEP = "1";
    try {
      await w.ownerCh.send("first", { to: ["claude"] });
      await until("the first wake", () => calls().length === before + 1);
      await w.ownerCh.send("second, before the first wake was read", { to: ["claude"] });
      await Bun.sleep(3_500);
      expect(calls().length).toBe(before + 1);
    } finally {
      delete process.env.FAKE_WAKE_SLEEP;
    }
    await readAll();
    await w.ownerCh.send("third, after the agent read", { to: ["claude"] });
    await until("a wake for the third", () => calls().length === before + 2);
  });

  test("a message held back by a wake the agent never reads gets its wake once that one has been outstanding long enough", async () => {
    const before = await quiet();
    await w.ownerCh.send("never read", { to: ["claude"] });
    await until("the first wake", () => calls().length === before + 1);
    const first = Date.now();
    await w.ownerCh.send("held back", { to: ["claude"] });
    await until("the held-back message's wake", () => calls().length === before + 2, 20_000);
    expect(Date.now() - first).toBeGreaterThanOrEqual(4_000);
  });
});

describe("wake paths, commands and words", () => {
  test("each harness gets its in-session path or a reason", () => {
    expect(wakePath({ harness: "codex", session: "t" }, false)).toEqual({ kind: "command", via: "codex-queue", session: "t" });
    expect(wakePath({ harness: "opencode", session: "s" }, false)).toEqual({ kind: "command", via: "opencode-api", session: "s" });
    expect(wakePath({ harness: "claude", session: "c" }, true)).toEqual({ kind: "hooks" });
    expect(wakePath({ harness: "claude", session: "c" }, false).kind).toBe("none");
    expect(wakePath({ harness: "codex" }, true).kind).toBe("none");
    expect(wakePath({ harness: "grok", session: "g" }, true).kind).toBe("none");
    expect(wakePath({ harness: "gemini" }, true).kind).toBe("none");
    expect(wakePath({ harness: "cursor" }, true).kind).toBe("none");
    expect(wakePath({ harness: "zcode", session: "zcode-pid-9" }, true)).toEqual({ kind: "none", why: "ZCode gives Kiwi no way to start a turn in a running session" });
    expect(wakePath({ harness: "kimi", session: "kimi-pid-9" }, true)).toEqual({
      kind: "none",
      why: "Kimi Code gives Kiwi no way to start a turn in a session run in its terminal; one opened with kimi web (or /web) can be woken",
    });
    expect(wakePath({ harness: "kimi", session: "kimi-pid-9", served: true }, true)).toEqual({ kind: "none", why: "Kiwi learns which Kimi Code session this is when its turn ends" });
    expect(wakePath({ harness: "kimi", session: "kimi-pid-9", served: true, harnessSession: "session_1" }, true)).toEqual({ kind: "command", via: "kimi-server", session: "session_1" });
    expect(wakePath({ harness: "mimo", session: "ses_1" }, true)).toEqual({ kind: "none", why: "Kiwi's MiMoCode plugin isn't installed (kiwi hooks install mimo, then restart MiMoCode)" });
    expect(wakePath({ harness: "mimo", session: "mimo-pid-9" }, true, false, { mimo: true })).toEqual({
      kind: "none",
      why: "this MiMoCode session started before Kiwi's MiMoCode plugin was installed (restarting MiMoCode loads it)",
    });
    expect(wakePath({ harness: "mimo", session: "ses_1" }, false, false, { mimo: true })).toEqual({ kind: "extension", via: "mimo-plugin" });
    expect(wakePath({ harness: "mimo", session: "ses_1" }, true, false, { pi: true }).kind).toBe("none");
    expect(wakePath({ harness: "grok-bot" }, true)).toEqual({ kind: "none", why: "no routine webhook is set for it yet (kiwi wake webhook URL)" });
    expect(wakePath({ harness: "grok-bot" }, false, true)).toEqual({ kind: "command", via: "webhook", session: "webhook" });
    expect(wakePath({ harness: "codex" }, true, true).kind).toBe("none");
    expect(wakePath({ harness: "pi", session: "pi-s1" }, false, false, { pi: true })).toEqual({ kind: "extension", via: "pi-extension" });
    expect(wakePath({ harness: "pi" }, true, false, { pi: true })).toEqual({ kind: "none", why: "this Pi session started before Kiwi's Pi extension was installed (/reload in Pi loads it)" });
    expect(wakePath({ harness: "pi", session: "pi-s1" }, true, true, { mimo: true })).toEqual({ kind: "none", why: "Kiwi's Pi extension isn't installed (kiwi hooks install pi, then /reload in Pi)" });
    expect(wakePath({}, true).kind).toBe("none");
    expect(wakePath(null, true).kind).toBe("none");
    const plugin = wakePath({ harness: "mimo", session: "ses_1" }, false, false, { mimo: true });
    expect(listenedPath(plugin, true)).toEqual(plugin);
    expect(listenedPath(plugin, false)).toEqual({
      kind: "none",
      why: "Kiwi's MiMoCode plugin has no listener running for this session (it starts with the session or its first shell command; restarting MiMoCode starts it again)",
    });
    expect(listenedPath({ kind: "extension", via: "pi-extension" }, false)).toEqual({
      kind: "none",
      why: "Kiwi's Pi extension has no listener running for this session (/reload in Pi starts it again)",
    });
    expect(listenedPath({ kind: "hooks" }, false)).toEqual({ kind: "hooks" });
    expect(listenedPath({ kind: "command", via: "codex-queue", session: "t" }, false)).toEqual({ kind: "command", via: "codex-queue", session: "t" });
  });

  test("the newest binding of an agent decides, even one with no session", () => {
    const cfg: Config = {
      channels: {},
      bindings: {
        "/old": { alias: "test", as: "claude", harness: "codex", session: "old-thread", seen: 1 },
        "/new": { alias: "test", as: "claude", harness: "gemini", seen: 2 },
      },
    };
    expect(seatRecordFor(cfg, "test", "claude")?.harness).toBe("gemini");
    expect(wakePath(seatRecordFor(cfg, "test", "claude"), true).kind).toBe("none");
  });

  test("the commands start nothing new: they hand a fixed prompt to the running session", () => {
    expect(wakeArgv("codex-queue", "t", "p")).toEqual(["codex", "queue", "--thread", "t", "--message", "p"]);
    expect(wakeArgv("opencode-api", "s", "p")).toEqual(["opencode", "api", "session.prompt", "--param", "sessionID=s", "-d", '{"text":"p","delivery":"queue"}']);
  });

  test("the prompt holds whether a prompt hook already showed the messages or not", () => {
    expect(wakePrompt("c", "w")).toBe('New Kiwi messages for you in "c". If they aren\'t shown here, read them with: kiwi -c c --as w listen --now, then act on them.');
  });

  test("the prompt's read command is quoted for a shell", () => {
    expect(wakePrompt("release notes", "worker")).toContain("kiwi -c 'release notes' --as worker listen --now");
    expect(wakePrompt("it's; rm -rf ~", "w")).toContain(`kiwi -c 'it'\\''s; rm -rf ~' --as w listen --now`);
  });

  test("an agent is told how messages reach it, without a Monitor", () => {
    expect(howMessagesReachYou("kiwi", true, { harness: "codex", session: "t" })).toContain("Kiwi wakes you in this session");
    const gemini = howMessagesReachYou("kiwi", true, { harness: "gemini" });
    expect(gemini).toContain("Kiwi can't wake you in this session: Gemini CLI gives Kiwi no way to start a turn in a running session.");
    expect(gemini).toContain("Run `kiwi listen --now` at the start of every turn and again before you end one.");
    expect(gemini).not.toContain("Monitor");
    const pi = howMessagesReachYou("kiwi", true, { harness: "pi" });
    expect(pi).toContain("Kiwi can't wake you in this session: Kiwi's Pi extension isn't installed (kiwi hooks install pi, then /reload in Pi).");
    expect(pi).toContain("Run `kiwi listen --now` at the start of every turn");
    const cursor = howMessagesReachYou("kiwi", true, { harness: "cursor", session: "chat-1" });
    expect(cursor).toContain("run `kiwi listen --once` with the Shell tool as a background command (is_background: true)");
    expect(cursor).toContain("Cursor starts your next turn with its output");
    expect(cursor).not.toContain("listen --now");
    expect(pullsWake("cursor")).toBe(true);
    const zcode = howMessagesReachYou("kiwi -c ch --as glm", true, { harness: "zcode", session: "zcode-pid-7", pid: 7 });
    expect(zcode).toContain("call the Bash tool with command `kiwi -c ch --as glm listen --once`, run_in_background: true, and no timeout");
    expect(zcode).toContain("ZCode starts your next turn when it exits");
    expect(zcode).toContain("won't be shown again");
    expect(zcode).toContain("Before you end any turn, check it is still running; if not, start it.");
    expect(zcode).not.toContain("listen --now");
    expect(pullsWake("zcode")).toBe(true);
    expect(pullsWake("grok")).toBe(true);
    expect(pullsWake("gemini")).toBe(false);
    const off = howMessagesReachYou("kiwi", false, { harness: "codex", session: "t" });
    expect(off).toContain("Kiwi won't wake you");
    expect(off).toContain("Run `kiwi listen --now` at the start of every turn");
  });

  test("Kimi Code and Grok are told the exact tool call that keeps them wakeable", () => {
    const kimi = howMessagesReachYou("kiwi -c ch --as k3", true, { harness: "kimi", session: "kimi-pid-7", pid: 7 });
    expect(kimi).toContain("call the Bash tool with command `kiwi -c ch --as k3 listen --once`, run_in_background: true, disable_timeout: true");
    expect(kimi).toContain("from your main session (not a subagent)");
    expect(kimi).toContain("If the notice names an output file, read that whole file: it holds your messages.");
    expect(kimi).toContain(
      "If it shows the output inline instead and says it is truncated, the start is cut off: run `kiwi -c ch --as k3 log -n 100` (it marks nothing read) and read back to the last message you handled before this wake.",
    );
    expect(kimi).toContain("If the oldest message it shows is still newer than that one, run it again with a larger -n until it reaches it.");
    expect(kimi).toContain("won't be shown again");
    expect(kimi).not.toContain("the notice shows the messages");
    expect(kimi).toContain("again every time it wakes you");
    expect(kimi).toContain("check TaskList shows it running");
    expect(kimi).not.toContain("listen --now");
    const grok = howMessagesReachYou("kiwi", true, { harness: "grok", session: "g" });
    expect(grok).toContain('start the monitor tool with command `kiwi listen`, description "kiwi listen", persistent: true');
    expect(grok).toContain("start it again the same way");
    expect(grok).not.toContain("listen --once");
    expect(grok).not.toContain("leader");
    expect(howMessagesReachYou("kiwi", false, { harness: "grok", session: "g" })).toContain("Run `kiwi listen --now`");
  });

  test("a Grok Bot is told to set up its routine's webhook until it has one, then that Kiwi wakes it", () => {
    const before = howMessagesReachYou("kiwi", true, { harness: "grok-bot" });
    expect(before).toContain('printf %s "$AUTHORIZATION" | kiwi wake webhook <the routine\'s URL>');
    expect(before).toContain("Run `kiwi listen --now` at the start of every turn");
    expect(howMessagesReachYou("kiwi", true, { harness: "grok-bot" }, true)).toBe("Kiwi wakes you in this session when a message for you arrives (its routine's webhook). Don't run listen.");
  });
});
