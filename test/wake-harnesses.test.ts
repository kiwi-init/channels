import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, updateConfig } from "../src/config.ts";
import { bindHeldSeat, holdSeat } from "../src/hold.ts";
import { wakeKey, wakePrompt } from "@kiwi/core/wake.ts";
import { wakeHarness } from "./wake-harness.ts";

setDefaultTimeout(60_000);

const w = wakeHarness();
const { fake, calls, bindAs, until, seat, quiet, bin, doneLog } = w;

describe("waking an agent in its own session, by harness, and when the daemon stops", () => {
  test("a daemon whose PATH lacks the harness still finds it in ~/.local/bin", async () => {
    const before = await quiet();
    const fakeHome = mkdtempSync(join(tmpdir(), "kiwi-wake-home-"));
    mkdirSync(join(fakeHome, ".local", "bin"), { recursive: true });
    const local = join(fakeHome, ".local", "bin", "codex");
    writeFileSync(local, `#!/bin/sh\necho codex >> "$FAKE_WAKE_LOG"\nfor a in "$@"; do echo "$a" >> "$FAKE_WAKE_LOG"; done\necho "---" >> "$FAKE_WAKE_LOG"\n`);
    chmodSync(local, 0o755);
    const prior = { home: process.env.HOME, path: process.env.PATH };
    rmSync(join(bin, "codex"));
    process.env.HOME = fakeHome;
    process.env.PATH = "/usr/bin:/bin";
    try {
      await w.ownerCh.send("found through the fallback", { to: ["claude"] });
      await until("a wake from the fallback directory", () => calls().length === before + 1);
    } finally {
      process.env.HOME = prior.home;
      process.env.PATH = prior.path;
      fake("codex");
      rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  test("an OpenCode agent gets the prompt through OpenCode's service, queued", async () => {
    bindAs({ harness: "opencode", session: "ses_1" });
    const before = await quiet();
    await w.ownerCh.send("for opencode", { to: ["claude"] });
    await until("an opencode wake", () => calls().length === before + 1);
    expect(calls().at(-1)).toEqual(["opencode", "api", "session.prompt", "--param", "sessionID=ses_1", "-d", JSON.stringify({ text: wakePrompt("test", "claude"), delivery: "queue" })]);
  });

  test("a Grok agent is never woken, and the daemon says why", async () => {
    bindAs({ harness: "grok", session: "g-1" });
    const before = await quiet();
    await w.ownerCh.send("for grok", { to: ["claude"] });
    await Bun.sleep(2_000);
    expect(calls().length).toBe(before);
    expect((await seat())?.wake.path).toMatchObject({ kind: "none" });
  });

  test("a Codex seat its loop holds is never woken, and the next message wakes the thread the loop binds it to, never the old one", async () => {
    bindAs({ harness: "codex", session: "thread-old" });
    const before = await quiet();
    expect(holdSeat("test", "claude", "loop-token")).toEqual({ kind: "changed", seats: 1 });
    await w.ownerCh.send("while held", { to: ["claude"] });
    await Bun.sleep(2_500);
    expect(calls().length).toBe(before);
    expect((await seat())?.wake.path).toEqual({ kind: "none", why: "its loop holds it between sessions, and wakes nothing until it hands the seat to a new session" });
    expect(bindHeldSeat("test", "claude", "loop-token", { harness: "codex", session: "thread-new" })).toEqual({ kind: "changed", seats: 1 });
    await w.ownerCh.send("after the hand-over", { to: ["claude"] });
    await until("a wake of the new thread", () => calls().length === before + 1);
    expect(calls().at(-1)).toEqual(["codex", "queue", "--thread", "thread-new", "--message", wakePrompt("test", "claude")]);
    expect(calls().flat()).not.toContain("thread-old");
  });

  test("a Grok Bot is woken by POSTing to its routine's webhook, with the Authorization header piped to kiwi wake webhook", async () => {
    const posts: { auth: string | null; body: { channel: string; agent: string; unread: number; prompt: string } }[] = [];
    const hook = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async (req) => {
        posts.push({ auth: req.headers.get("authorization"), body: (await req.json()) as (typeof posts)[number]["body"] });
        return new Response("ok");
      },
    });
    bindAs({ harness: "grok-bot" });
    const url = `https://example.test/routine`;
    const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), "-c", "test", "--as", "claude", "wake", "webhook", url], {
      env: { ...process.env, KIWI_RELAY: w.relay },
      stdin: new Blob(["Bearer routine-secret\n"]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [said, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    expect(await p.exited, err).toBe(0);
    expect(said).toContain("by POSTing to example.test with the Authorization header from stdin");
    expect(said).not.toContain("routine-secret");
    expect(loadConfig().wakeHooks?.[wakeKey("test", "claude")]).toEqual({ url, authorization: "Bearer routine-secret" });
    updateConfig((cfg) => {
      cfg.wakeHooks = { [wakeKey("test", "claude")]: { url: hook.url.href, authorization: "Bearer routine-secret" } };
    });
    try {
      await quiet();
      await w.ownerCh.send("for grok bot", { to: ["claude"] });
      await until("a webhook wake", () => posts.length === 1);
      expect(posts[0]).toEqual({ auth: "Bearer routine-secret", body: { channel: "test", agent: "claude", unread: 1, prompt: wakePrompt("test", "claude") } });
      expect(JSON.stringify(posts[0]!.body)).not.toContain("for grok bot");
      await until("the daemon says it wakes via the webhook", async () => (await seat())?.wake.path.kind === "command");
    } finally {
      hook.stop(true);
      updateConfig((cfg) => {
        delete cfg.wakeHooks;
      });
    }
  });

  test("stopping the daemon stops a wake that is still running", async () => {
    bindAs({ harness: "codex", session: "thread-1" });
    const before = await quiet();
    rmSync(doneLog, { force: true });
    process.env.FAKE_WAKE_SLEEP = "3";
    try {
      await w.ownerCh.send("one last wake", { to: ["claude"] });
      await until("the wake to start", () => calls().length === before + 1);
      await w.stopDaemon();
      await Bun.sleep(4_000);
      expect(existsSync(doneLog)).toBe(false);
    } finally {
      delete process.env.FAKE_WAKE_SLEEP;
    }
  });
});
