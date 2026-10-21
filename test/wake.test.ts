import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession, runAgent } from "../src/agent.ts";
import { Channel } from "@kiwi/core/client.ts";
import { loadConfig, saveConfig, saveIdentity, updateConfig, type Config, type SeatRecord } from "../src/config.ts";
import { daemonListening, seatRecordFor, startDaemon, type Daemon } from "../src/daemon.ts";
import { howMessagesReachYou } from "../src/hooks.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import type { Presence } from "@kiwi/core/protocol.ts";
import { bindHeldSeat, holdSeat } from "../src/hold.ts";
import { startRelay } from "../src/relay/bun.ts";
import { listenedPath, pullsWake, wakeArgv, wakeKey, wakePath, wakePrompt } from "@kiwi/core/wake.ts";

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
    .slice(0, -1)
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
  daemon = await startDaemon(undefined, { beaconMs: 2_000, wakeDelayMs: 800, wakeGapMs: 1_500, wakeOutstandingMs: 5_000 });
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
    const readTo = await ownerCh.head();
    await ownerCh.send("the secret plan is in room 4", { to: ["claude"] });
    await until("a wake", () => calls().length === 1);
    expect(calls()[0]).toEqual(["codex", "queue", "--thread", "thread-1", "--message", wakePrompt("test", "claude")]);
    expect(readFileSync(wakeLog, "utf8")).not.toContain("secret");
    await until("the wake's record", async () => (await seat())?.wake.last !== null);
    expect((await seat())?.wake.last).toMatchObject({ via: "codex-queue", unread: 1, ok: true });
    await until("the wake log", () => existsSync(join(home, "wake.log")));
    expect(readFileSync(join(home, "wake.log"), "utf8")).toContain("\ttest\tclaude\tcodex-queue\t1\tok");
    expect(readFileSync(join(home, "wake.log"), "utf8").trimEnd().split("\t").slice(3)).toEqual(["codex-queue", "1", "ok", "", String(readTo)]);
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

  test("a message that arrives before the agent has read its last wake gets no wake of its own, and one after the agent read does", async () => {
    const before = await quiet();
    process.env.FAKE_WAKE_SLEEP = "1";
    try {
      await ownerCh.send("first", { to: ["claude"] });
      await until("the first wake", () => calls().length === before + 1);
      await ownerCh.send("second, before the first wake was read", { to: ["claude"] });
      await Bun.sleep(3_500);
      expect(calls().length).toBe(before + 1);
    } finally {
      delete process.env.FAKE_WAKE_SLEEP;
    }
    await readAll();
    await ownerCh.send("third, after the agent read", { to: ["claude"] });
    await until("a wake for the third", () => calls().length === before + 2);
  });

  test("a message held back by a wake the agent never reads gets its wake once that one has been outstanding long enough", async () => {
    const before = await quiet();
    await ownerCh.send("never read", { to: ["claude"] });
    await until("the first wake", () => calls().length === before + 1);
    const first = Date.now();
    await ownerCh.send("held back", { to: ["claude"] });
    await until("the held-back message's wake", () => calls().length === before + 2, 20_000);
    expect(Date.now() - first).toBeGreaterThanOrEqual(4_000);
  });

  test("a wake still unread in an old session doesn't hold back the wake of the session that replaced it", async () => {
    const before = await quiet();
    try {
      await ownerCh.send("for the old session", { to: ["claude"] });
      await until("the old session's wake", () => calls().length === before + 1);
      await until("the wake's record", async () => (await seat())?.wake.last?.ok === true);
      bindAs({ harness: "codex", session: "thread-replacement" });
      await ownerCh.send("for the new session", { to: ["claude"] });
      await until("the new session's wake", () => calls().length === before + 2, 3_500);
      expect(calls().at(-1)).toContain("thread-replacement");
    } finally {
      bindAs({ harness: "codex", session: "thread-1" });
    }
  });

  test("an agent that read the woken-for message as a reply, without moving its cursor, is woken for the next one", async () => {
    const before = await quiet();
    const cfg = loadConfig().channels.test;
    if (!cfg) throw new Error("the test channel is missing");
    const s = await AgentSession.open("test", cfg, "claude");
    const from = await ownerCh.head();
    const reply = await ownerCh.send("a reply to the agent", { to: ["claude"], re: [from] });
    await until("the reply's wake", () => calls().length === before + 1);
    const replies = await runAgent(s.awaitReplies(from, from, 2));
    expect(replies.map((r) => r.seq)).toContain(reply);
    const { messages, state } = await runAgent(s.state());
    expect(await runAgent(s.unreadCount(state, messages))).toBe(0);
    await ownerCh.send("after the reply was read", { to: ["claude"] });
    await until("the next message's wake", () => calls().length === before + 2, 3_500);
  });

  test("a binding that changes after the message is the one woken", async () => {
    const before = await quiet();
    const sent = ownerCh.send("for the new thread", { to: ["claude"] });
    bindAs({ harness: "codex", session: "thread-2" });
    await sent;
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
      const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), "-c", "test", "--as", "claude", ...args], {
        env: { ...process.env, KIWI_RELAY: relay },
        stdout: "pipe",
        stderr: "pipe",
      });
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

  test("a wake that fails says why in the wake log", async () => {
    const before = await quiet();
    writeFileSync(join(bin, "codex"), "#!/bin/sh\necho boom >&2\nexit 3\n");
    try {
      await ownerCh.send("the wake will fail", { to: ["claude"] });
      await until("the failure in the log", () => existsSync(join(home, "wake.log")) && readFileSync(join(home, "wake.log"), "utf8").includes("\tfailed\texit 3: boom"));
    } finally {
      fake("codex");
    }
    expect(calls().length).toBe(before);
  });

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
      await ownerCh.send("found through the fallback", { to: ["claude"] });
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

  test("a Codex seat its loop holds is never woken, and the next message wakes the thread the loop binds it to, never the old one", async () => {
    bindAs({ harness: "codex", session: "thread-old" });
    const before = await quiet();
    expect(holdSeat("test", "claude", "loop-token")).toEqual({ kind: "changed", seats: 1 });
    await ownerCh.send("while held", { to: ["claude"] });
    await Bun.sleep(2_500);
    expect(calls().length).toBe(before);
    expect((await seat())?.wake.path).toEqual({ kind: "none", why: "its loop holds it between sessions, and wakes nothing until it hands the seat to a new session" });
    expect(bindHeldSeat("test", "claude", "loop-token", { harness: "codex", session: "thread-new" })).toEqual({ kind: "changed", seats: 1 });
    await ownerCh.send("after the hand-over", { to: ["claude"] });
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
      env: { ...process.env, KIWI_RELAY: relay },
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
      await ownerCh.send("for grok bot", { to: ["claude"] });
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
