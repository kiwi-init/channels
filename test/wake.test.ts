import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession, runAgent } from "../src/agent.ts";
import { Channel } from "../src/client.ts";
import { loadConfig, saveConfig, saveIdentity, updateConfig, type Config, type SeatRecord } from "../src/config.ts";
import { daemonListening, seatRecordFor, startDaemon, type Daemon } from "../src/daemon.ts";
import { howMessagesReachYou } from "../src/hooks.ts";
import { generateIdentity } from "../src/identity.ts";
import type { Presence } from "../src/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { wakeArgv, wakeKey, wakePath, wakePrompt } from "../src/wake.ts";

setDefaultTimeout(60_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-wake-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-wake-relay-"));
const bin = mkdtempSync(join(tmpdir(), "kiwi-wake-bin-"));
const wakeLog = join(bin, "calls.log");
const doneLog = join(bin, "done.log");
const prev = { home: process.env.KIWI_HOME, path: process.env.PATH, log: process.env.FAKE_WAKE_LOG };
process.env.KIWI_HOME = home;
process.env.FAKE_WAKE_LOG = wakeLog;
process.env.PATH = `${bin}:${process.env.PATH ?? ""}`;

let server: ReturnType<typeof startRelay> | undefined;
let relay = "";
let port = 0;
let ownerCh: Channel;
let daemon: Daemon | undefined;
let claudePk = "";
const heard: (Presence & { sigOk: boolean })[] = [];
const watching = new AbortController();

const fake = (name: string): void => {
  const path = join(bin, name);
  writeFileSync(
    path,
    `#!/bin/sh\necho "${name}" >> "$FAKE_WAKE_LOG"\nfor a in "$@"; do echo "$a" >> "$FAKE_WAKE_LOG"; done\necho "---" >> "$FAKE_WAKE_LOG"\nif [ -n "$FAKE_WAKE_SLEEP" ]; then sleep "$FAKE_WAKE_SLEEP"; echo finished >> "${doneLog}"; fi\n`,
  );
  chmodSync(path, 0o755);
};

const calls = (): string[][] =>
  (existsSync(wakeLog) ? readFileSync(wakeLog, "utf8") : "")
    .split("---\n")
    .filter((c) => c.trim())
    .map((c) => c.trim().split("\n"));

const bindAs = (record: Omit<SeatRecord, "alias" | "as">): void => {
  updateConfig((cfg) => {
    cfg.bindings = { "/work": { alias: "test", as: "claude", ...record } };
  });
};

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

const readAll = async (): Promise<void> => {
  const s = await AgentSession.open("test", loadConfig().channels.test!, "claude");
  await runAgent(s.read());
};

const seat = async () => (await daemonListening()).find((s) => s.agent === "claude");

const quiet = async (): Promise<number> => {
  await readAll();
  await Bun.sleep(1_600);
  return calls().length;
};

beforeAll(async () => {
  fake("codex");
  fake("opencode");
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  port = Number(server.url.port);
  const owner = await generateIdentity("human");
  const agent = await generateIdentity("claude");
  const made = await Channel.create(relay, owner, { name: "human" }, [{ ...agent, info: { name: "claude" } }]);
  ownerCh = new Channel(made.access, relay, owner);
  claudePk = agent.pk;
  saveConfig({ channels: { test: { ...(await Channel.resume(relay, made.code, agent)), relay, code: made.code, as: "claude" } } });
  saveIdentity(agent, made.access.roomId);
  bindAs({ harness: "codex", session: "thread-1" });
  await readAll();
  void ownerCh.stream(await ownerCh.head(), () => {}, { signal: watching.signal, onPresence: (p) => heard.push(p) });
  daemon = await startDaemon(undefined, { beaconMs: 2_000, wakeDelayMs: 800, wakeGapMs: 1_500 });
  await until("claude's seat", async () => (await seat()) !== undefined);
});

afterAll(async () => {
  watching.abort();
  await daemon?.stop().catch(() => {});
  server?.stop(true);
  if (prev.home === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prev.home;
  if (prev.path === undefined) delete process.env.PATH;
  else process.env.PATH = prev.path;
  if (prev.log === undefined) delete process.env.FAKE_WAKE_LOG;
  else process.env.FAKE_WAKE_LOG = prev.log;
  delete process.env.FAKE_WAKE_SLEEP;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(bin, { recursive: true, force: true });
});

describe("waking an agent in its own session", () => {
  test("a message for a Codex agent queues one turn in its thread, with a prompt that carries no message text", async () => {
    await ownerCh.send("the secret plan is in room 4", { to: ["claude"] });
    await until("a wake", () => calls().length === 1);
    expect(calls()[0]).toEqual(["codex", "queue", "--thread", "thread-1", "--message", wakePrompt("test", "claude")]);
    expect(readFileSync(wakeLog, "utf8")).not.toContain("secret");
    await until("the wake's record", async () => (await seat())?.wake.last !== null);
    expect((await seat())?.wake.last).toMatchObject({ via: "codex-queue", unread: 1, ok: true });
    await until("the wake log", () => existsSync(join(home, "wake.log")));
    expect(readFileSync(join(home, "wake.log"), "utf8")).toContain("\ttest\tclaude\tcodex-queue\t1\tok");
    await until("presence saying how it wakes", () => heard.some((p) => p.pk === claudePk && p.wake === "codex-queue"));
  });

  test("a burst of messages is one wake, and none comes while the gap lasts", async () => {
    const before = await quiet();
    await ownerCh.send("one", { to: ["claude"] });
    await ownerCh.send("two", { to: ["claude"] });
    await ownerCh.send("three", { to: ["claude"] });
    await until("one wake", () => calls().length === before + 1);
    await Bun.sleep(1_000);
    expect(calls().length).toBe(before + 1);
  });

  test("an agent that has read since the message isn't woken", async () => {
    const before = await quiet();
    await ownerCh.send("read this before the wake", { to: ["claude"] });
    await readAll();
    await Bun.sleep(2_000);
    expect(calls().length).toBe(before);
  });

  test("a message that isn't for the agent doesn't wake it", async () => {
    const before = await quiet();
    await ownerCh.send("for someone else", { to: ["nobody"] });
    await Bun.sleep(2_000);
    expect(calls().length).toBe(before);
  });

  test("a message that arrives during a slow wake gets a wake of its own once the gap is over", async () => {
    const before = await quiet();
    process.env.FAKE_WAKE_SLEEP = "2";
    try {
      await ownerCh.send("first", { to: ["claude"] });
      await until("the first wake", () => calls().length === before + 1);
      await ownerCh.send("second, during the wake", { to: ["claude"] });
      await until("the second wake", () => calls().length === before + 2, 20_000);
    } finally {
      delete process.env.FAKE_WAKE_SLEEP;
    }
  });

  test("a binding that changes after the message is the one woken", async () => {
    const before = await quiet();
    await ownerCh.send("for the new thread", { to: ["claude"] });
    bindAs({ harness: "codex", session: "thread-2" });
    try {
      await until("a wake", () => calls().length === before + 1);
      expect(calls().at(-1)).toContain("thread-2");
    } finally {
      bindAs({ harness: "codex", session: "thread-1" });
    }
  });

  test("an unread check that fails is tried again once the relay answers", async () => {
    const before = await quiet();
    await ownerCh.send("while the relay goes away", { to: ["claude"] });
    server!.stop(true);
    await Bun.sleep(2_500);
    expect(calls().length).toBe(before);
    server = startRelay({ port, hostname: "127.0.0.1", dataDir });
    await until("the wake after the relay is back", () => calls().length === before + 1, 25_000);
  });

  test("kiwi wake off keeps it asleep, presence stops saying it wakes, and kiwi wake on brings it back", async () => {
    await readAll();
    const cli = async (...args: string[]): Promise<string> => {
      const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), "-c", "test", "--as", "claude", ...args], { env: { ...process.env, KIWI_RELAY: relay }, stdout: "pipe", stderr: "pipe" });
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      expect(await p.exited, err).toBe(0);
      return out;
    };
    expect(await cli("wake", "off")).toContain("won't wake claude");
    expect(loadConfig().wakeOff).toEqual([wakeKey("test", "claude")]);
    try {
      expect(await cli("wake")).toStartWith("wake off · wakes via codex queue");
      await Bun.sleep(1_600);
      const before = calls().length;
      await ownerCh.send("while asleep", { to: ["claude"] });
      await Bun.sleep(2_000);
      expect(calls().length).toBe(before);
      expect((await seat())?.wake.on).toBe(false);
      const fresh: Presence[] = [];
      const look = new AbortController();
      void ownerCh.stream(await ownerCh.head(), () => {}, { signal: look.signal, onPresence: (p) => void fresh.push(p) });
      try {
        await until("presence without wake", () => fresh.some((p) => p.pk === claudePk && p.client === "daemon" && p.wake === undefined));
      } finally {
        look.abort();
      }
    } finally {
      expect(await cli("wake", "on")).toContain("Kiwi wakes claude");
    }
    expect(loadConfig().wakeOff).toBeUndefined();
  });

  test("an OpenCode agent gets the prompt through OpenCode's service, queued", async () => {
    bindAs({ harness: "opencode", session: "ses_1" });
    const before = await quiet();
    await ownerCh.send("for opencode", { to: ["claude"] });
    await until("an opencode wake", () => calls().length === before + 1);
    expect(calls().at(-1)).toEqual(["opencode", "api", "session.prompt", "--param", "sessionID=ses_1", "-d", JSON.stringify({ text: wakePrompt("test", "claude"), delivery: "queue" })]);
  });

  test("a Grok agent is never woken, and the daemon says why", async () => {
    bindAs({ harness: "grok", session: "g-1" });
    const before = await quiet();
    await ownerCh.send("for grok", { to: ["claude"] });
    await Bun.sleep(2_000);
    expect(calls().length).toBe(before);
    expect((await seat())?.wake.path).toMatchObject({ kind: "none" });
  });

  test("stopping the daemon stops a wake that is still running", async () => {
    bindAs({ harness: "codex", session: "thread-1" });
    const before = await quiet();
    rmSync(doneLog, { force: true });
    process.env.FAKE_WAKE_SLEEP = "3";
    try {
      await ownerCh.send("one last wake", { to: ["claude"] });
      await until("the wake to start", () => calls().length === before + 1);
      await daemon!.stop();
      daemon = undefined;
      await Bun.sleep(4_000);
      expect(existsSync(doneLog)).toBe(false);
    } finally {
      delete process.env.FAKE_WAKE_SLEEP;
    }
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
    expect(wakePath({ harness: "kimi", session: "kimi-pid-9" }, true)).toEqual({ kind: "none", why: "Kimi Code gives Kiwi no way to start a turn in a running session" });
    expect(wakePath({ harness: "mimo", session: "mimo-pid-9" }, true)).toEqual({ kind: "none", why: "MiMoCode gives Kiwi no way to start a turn in a running session" });
    expect(wakePath({}, true).kind).toBe("none");
    expect(wakePath(null, true).kind).toBe("none");
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

  test("the prompt's read command is quoted for a shell", () => {
    expect(wakePrompt("release notes", "worker")).toContain("kiwi -c 'release notes' --as worker listen --now");
    expect(wakePrompt("it's; rm -rf ~", "w")).toContain(`kiwi -c 'it'\\''s; rm -rf ~' --as w listen --now`);
  });

  test("an agent is told how messages reach it, without a Monitor", () => {
    expect(howMessagesReachYou("kiwi", true, { harness: "codex", session: "t" })).toContain("Kiwi wakes you in this session");
    const grok = howMessagesReachYou("kiwi", true, { harness: "grok", session: "g" });
    expect(grok).toContain("Kiwi can't wake you in this session");
    expect(grok).toContain("kiwi listen --now");
    expect(grok).not.toContain("Monitor");
    const off = howMessagesReachYou("kiwi", false, { harness: "codex", session: "t" });
    expect(off).toContain("Kiwi won't wake you");
    expect(off).toContain("kiwi listen --now");
  });
});
