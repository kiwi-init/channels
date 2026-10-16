import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentSession, runAgent } from "../src/agent.ts";
import { Channel } from "../src/client.ts";
import { forgetIdentity, identitiesIn, loadConfig, saveConfig, saveIdentity, type SeatRecord } from "../src/config.ts";
import { activityEnv, reachOf, daemonHello, daemonListening, daemonSock, listenDaemon, reportRead, startDaemon, stopDaemon, type Daemon } from "../src/daemon.ts";
import { presenceWords } from "../src/format.ts";
import { generateIdentity, type Identity } from "../src/identity.ts";
import type { Presence } from "../src/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { checked } from "./check.ts";

setDefaultTimeout(60_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-daemon-seats-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-daemon-seats-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay> | undefined;
let relay = "";
let ownerCh: Channel;
let daemon: Daemon | undefined;
let code = "";
let roomId = "";
let claudePk = "";
let geminiPk = "";
let ownerId: Identity;
const heard: (Presence & { sigOk: boolean })[] = [];
const watching = new AbortController();

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  const owner = await generateIdentity("human");
  ownerId = owner;
  const agent = await generateIdentity("claude");
  const made = await Channel.create(relay, owner, { name: "human" }, [{ ...agent, info: { name: "claude" } }]);
  ownerCh = new Channel(made.access, relay, owner);
  code = made.code;
  roomId = made.access.roomId;
  claudePk = agent.pk;
  saveConfig({ channels: { test: { ...(await Channel.resume(relay, made.code, agent)), relay, code: made.code, as: "claude" } } });
  saveIdentity(agent, made.access.roomId);
  void ownerCh.stream(await ownerCh.head(), () => {}, { signal: watching.signal, onPresence: (p) => heard.push(p) });
  daemon = await startDaemon(undefined, { beaconMs: 300 });
});

afterAll(async () => {
  watching.abort();
  await daemon?.stop().catch(() => {});
  await stopDaemon(daemonSock(home)).catch(() => {});
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

async function seatOf(agent: string) {
  return (await daemonListening()).find((s) => s.channel === "test" && s.agent === agent) ?? null;
}

const from = (pk: string) => heard.filter((p) => p.pk === pk && !p.query);

describe("seats always on", () => {
  test("with no subscriber, a joined agent's seat is open and the relay sees it as the daemon", async () => {
    await until("claude's seat", async () => (await seatOf("claude")) !== null);
    expect(await seatOf("claude")).toMatchObject({ channel: "test", agent: "claude", subscribers: 0, read: null, wake: { on: true, path: { kind: "none" }, last: null } });
    await until("claude's presence", () => from(claudePk).some((p) => p.client === "daemon" && p.reach === "unreachable"));
  });

  test("a read is recorded with its session and announced as readAt", async () => {
    const before = Date.now();
    await reportRead("test", "claude", "session-1");
    const seat = await seatOf("claude");
    expect(seat?.read?.session).toBe("session-1");
    expect(seat?.read?.at).toBeGreaterThanOrEqual(before);
    await until("a presence with readAt", () => from(claudePk).some((p) => typeof p.readAt === "number" && p.readAt >= before));
  });

  test("a new join is picked up without restarting the daemon", async () => {
    const gemini = await generateIdentity("gemini");
    geminiPk = gemini.pk;
    const ask = await Channel.requestJoin(relay, code, gemini, { name: "gemini" });
    await ownerCh.approve((await checked(ownerCh, relay, code, [{ id: gemini, requestId: ask.requestId }]))[0]!);
    saveIdentity(gemini, roomId);
    await until("gemini's seat", async () => (await seatOf("gemini")) !== null);
    await until("gemini's presence", () => from(geminiPk).some((p) => p.client === "daemon"));
  });

  test("who() shows another agent nobody listens for as not listening, with its read time, and your own seat from the daemon", async () => {
    const s = await AgentSession.open("test", loadConfig().channels.test!, "gemini");
    const online = await runAgent(s.who());
    expect(online.get("claude")?.client).toBe("daemon");
    expect(typeof online.get("claude")?.readAt).toBe("number");
    expect(online.get("gemini")?.client).toBe("daemon");
    expect(presenceWords(online.get("claude")!)).toStartWith("not listening · can't be woken · read ");
    expect(presenceWords(online.get("gemini")!)).toBe("reachable · can't be woken · not read yet");
  });

  test("a listener adds no presence of its own", async () => {
    const s = await AgentSession.open("test", loadConfig().channels.test!, "claude");
    const seen = from(claudePk).length;
    await runAgent(Effect.raceFirst(s.listen(() => Effect.void, {}), Effect.sleep(2_000)));
    expect(from(claudePk).slice(seen).every((p) => p.client === "daemon")).toBe(true);
  });

  test("a seat with a listener is announced as listening, and as unreachable again once it goes", async () => {
    const s = await AgentSession.open("test", loadConfig().channels.test!, "claude");
    const seen = from(claudePk).length;
    const heardListening = () => from(claudePk).slice(seen).some((p) => p.reach === "listening");
    await runAgent(Effect.raceFirst(s.listen(() => Effect.void, {}), Effect.promise(() => until("a listening presence", heardListening))));
    expect(heardListening()).toBe(true);
    const after = from(claudePk).length;
    await until("an unreachable presence", () => from(claudePk).slice(after).some((p) => p.reach === "unreachable"));
  });

  test("the daemon reports a Claude seat's activity from its record, even with no session id", async () => {
    const claudeDir = mkdtempSync(join(tmpdir(), "kiwi-daemon-seats-claude-"));
    mkdirSync(join(claudeDir, "sessions"), { recursive: true });
    writeFileSync(join(claudeDir, "sessions", "4242.json"), JSON.stringify({ status: "idle", statusUpdatedAt: 123 }));
    const prev = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    try {
      saveConfig({ ...loadConfig(), bindings: { "/work": { alias: "test", as: "claude", harness: "claude", pid: 4242 } } });
      await until("idle activity in claude's presence", () => from(claudePk).some((p) => p.activity?.state === "idle"));
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prev;
      rmSync(claudeDir, { recursive: true, force: true });
    }
  });

  test("a key saved before its join is approved gets its seat once the join is approved", async () => {
    const pending = await generateIdentity("cursor");
    const ask = await Channel.requestJoin(relay, code, pending, { name: "cursor" });
    saveIdentity(pending, roomId);
    await daemonListening();
    await Bun.sleep(1_000);
    expect(await seatOf("cursor")).toBeNull();
    await ownerCh.approve((await checked(ownerCh, relay, code, [{ id: pending, requestId: ask.requestId }]))[0]!);
    await until("cursor's seat after the approval", async () => (await seatOf("cursor")) !== null, 20_000);
  });

  test("the daemon holds no seat for a person, even when asked to listen as one", async () => {
    saveIdentity(ownerId, roomId);
    try {
      await expect(listenDaemon("test", "human", 0, { noSpawn: true })).rejects.toThrow("agents only");
      await Bun.sleep(500);
      expect(await seatOf("human")).toBeNull();
    } finally {
      forgetIdentity("human", roomId);
    }
  });

  test("a seat whose key goes while the relay is down never opens", async () => {
    const dana = await generateIdentity("dana");
    const ask = await Channel.requestJoin(relay, code, dana, { name: "dana" });
    await ownerCh.approve((await checked(ownerCh, relay, code, [{ id: dana, requestId: ask.requestId }]))[0]!);
    const port = Number(server!.url.port);
    server!.stop(true);
    saveIdentity(dana, roomId);
    await daemonListening();
    await Bun.sleep(700);
    forgetIdentity("dana", roomId);
    server = startRelay({ port, hostname: "127.0.0.1", dataDir });
    await until("claude's seat with the relay back", async () => (await seatOf("claude")) !== null);
    await Bun.sleep(2_500);
    expect(await seatOf("dana")).toBeNull();
  });

  test("removing an agent stops its seat and a restart doesn't bring it back; the key is the agent's own CLI to forget", async () => {
    await ownerCh.remove(geminiPk);
    await until("gemini's seat to stop", async () => (await seatOf("gemini")) === null);
    expect(identitiesIn(roomId)).toContain("gemini");
    await daemon!.stop();
    daemon = await startDaemon(undefined, { beaconMs: 300 });
    await until("claude's seat after the restart", async () => (await seatOf("claude")) !== null);
    await Bun.sleep(1_000);
    expect(await seatOf("gemini")).toBeNull();
  });
});

async function cli(args: string[], session = "cli-session", opts: { cwd?: string; kiwiHome?: string } = {}): Promise<string> {
  const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli/main.ts"), ...args], {
    cwd: opts.cwd ?? home,
    env: { ...process.env, KIWI_HOME: opts.kiwiHome ?? home, KIWI_RELAY: relay, CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  expect(await p.exited, err).toBe(0);
  return out;
}

describe("the CLI and the daemon", () => {
  test("an agent command starts the daemon, and listen --now reports the read with its session", async () => {
    await daemon!.stop();
    daemon = undefined;
    await cli(["-c", "test", "--as", "claude", "listen", "--now"]);
    expect((await daemonHello(daemonSock(home))).pid).not.toBe(process.pid);
    await until("the CLI's read", async () => (await seatOf("claude"))?.read?.session === "cli-session");
  });

  test("status shows your own seat as reachable and reports its read; who shows when the rest were last seen", async () => {
    await until("claude's seat", async () => (await seatOf("claude")) !== null);
    const status = await cli(["-c", "test", "--as", "claude", "status"], "status-session");
    expect(status).toMatch(/claude \(you\).* · reachable · /);
    await until("the status read", async () => (await seatOf("claude"))?.read?.session === "status-session");
    expect(await cli(["-c", "test", "--as", "claude", "who"])).toMatch(/^human .*· last seen /m);
  });

  test("tasks --global starts the daemon", async () => {
    await stopDaemon(daemonSock(home));
    await cli(["--as", "claude", "tasks", "--global"]);
    expect((await daemonHello(daemonSock(home))).pid).toBeGreaterThan(0);
  });

  test("a relative KIWI_HOME starts the daemon in that home, not inside it", async () => {
    await stopDaemon(daemonSock(home));
    await cli(["-c", "test", "--as", "claude", "read"], "relative-session", { cwd: dirname(home), kiwiHome: basename(home) });
    expect((await daemonHello(daemonSock(home))).pid).toBeGreaterThan(0);
    expect(existsSync(join(home, basename(home)))).toBe(false);
    await until("the read from a relative home", async () => (await seatOf("claude"))?.read?.session === "relative-session");
  });
});

describe("presenceWords", () => {
  test("a daemon seat is reachable, with its read time when it has one", () => {
    const now = Date.now();
    expect(presenceWords({ client: "daemon", readAt: now - 4 * 60_000, wake: "codex-queue" }, now)).toBe("reachable · wakes via codex queue · read 4m ago");
    expect(presenceWords({ client: "daemon" }, now)).toBe("reachable · can't be woken · not read yet");
    expect(presenceWords({ client: "daemon", wake: "something else" }, now)).toBe("reachable · can't be woken · not read yet");
    expect(presenceWords({ client: "web" }, now)).toBe("online (web)");
  });

  test("a seat nobody listens for is not listening, unless the daemon can wake it", () => {
    const now = Date.now();
    expect(presenceWords({ client: "daemon", reach: "unreachable" }, now)).toBe("not listening · can't be woken · not read yet");
    expect(presenceWords({ client: "daemon", reach: "unreachable", wake: "opencode-api" }, now)).toStartWith("reachable · wakes via ");
    expect(presenceWords({ client: "daemon", reach: "unreachable", wake: "hooks" }, now)).toStartWith("not listening · wakes via ");
    expect(presenceWords({ client: "daemon", reach: "listening" }, now)).toBe("reachable · can't be woken · not read yet");
    expect(presenceWords({ client: "daemon", reach: "running" }, now)).toBe("reachable · can't be woken · not read yet");
  });
});

describe("reachOf", () => {
  const seat = (r: Partial<SeatRecord>): SeatRecord => ({ alias: "test", as: "a", ...r });
  const alive = (pid: number) => pid === 7;

  test("a listener makes a seat listening, whatever its harness says", () => {
    expect(reachOf(true, null, undefined, alive)).toBe("listening");
    expect(reachOf(true, seat({ harness: "grok", session: "g" }), { state: "idle", since: 1 }, alive)).toBe("listening");
  });

  test("with no listener, a live harness process or a harness at work makes it running", () => {
    expect(reachOf(false, seat({ harness: "claude", pid: 7 }), undefined, alive)).toBe("running");
    expect(reachOf(false, seat({ harness: "grok", session: "g" }), { state: "working" }, alive)).toBe("running");
    expect(reachOf(false, seat({ harness: "codex", session: "c" }), { state: "waiting" }, alive)).toBe("running");
  });

  test("an idle session nobody listens for, or a dead process, is unreachable", () => {
    expect(reachOf(false, seat({ harness: "grok", session: "g" }), { state: "idle", since: 1 }, alive)).toBe("unreachable");
    expect(reachOf(false, seat({ harness: "claude", pid: 8 }), { state: "idle" }, alive)).toBe("unreachable");
    expect(reachOf(false, null, undefined, alive)).toBe("unreachable");
  });
});

describe("activityEnv", () => {
  const base = { HOME: "/home/x", CLAUDECODE: "1", CLAUDE_PID: "7", CLAUDE_CODE_SESSION_ID: "theirs", CODEX_THREAD_ID: "t" };
  const seat = (r: Partial<SeatRecord>): SeatRecord => ({ alias: "test", as: "a", ...r });

  test("names the seat's own harness session and drops the daemon's inherited one", () => {
    expect(activityEnv(seat({ harness: "codex", session: "c1" }), base)).toEqual({ HOME: "/home/x", CODEX_THREAD_ID: "c1" });
    expect(activityEnv(seat({ harness: "opencode", session: "o1" }), base)).toEqual({ HOME: "/home/x", OPENCODE_SESSION_ID: "o1" });
    expect(activityEnv(seat({ harness: "grok", session: "g1" }), base)).toEqual({ HOME: "/home/x", GROK_SESSION_ID: "g1" });
    expect(activityEnv(seat({ harness: "claude", session: "s1", pid: 42 }), base)).toEqual({ HOME: "/home/x", CLAUDECODE: "1", CLAUDE_PID: "42", CLAUDE_CODE_SESSION_ID: "s1" });
  });

  test("gives nothing when the seat can't be looked up", () => {
    expect(activityEnv(seat({ harness: "claude", session: "s1" }), base)).toBeNull();
    expect(activityEnv(seat({ harness: "codex" }), base)).toBeNull();
    expect(activityEnv(seat({ harness: "gemini", session: "x" }), base)).toBeNull();
    expect(activityEnv(seat({}), base)).toBeNull();
  });
});
