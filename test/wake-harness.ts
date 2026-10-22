import { afterAll, beforeAll } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentSession, runAgent } from "../src/agent.ts";
import { Channel } from "@kiwi/core/client.ts";
import { loadConfig, saveConfig, saveIdentity, updateConfig, type SeatRecord } from "../src/config.ts";
import { daemonListening, startDaemon, type Daemon } from "../src/daemon.ts";
import { generateIdentity } from "@kiwi/core/identity.ts";
import type { Presence } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";

export interface WakeHarness {
  readonly home: string;
  readonly bin: string;
  readonly wakeLog: string;
  readonly doneLog: string;
  readonly heard: (Presence & { sigOk: boolean })[];
  readonly ownerCh: Channel;
  readonly relay: string;
  readonly claudePk: string;
  fake(name: string): void;
  calls(): string[][];
  bindAs(record: Omit<SeatRecord, "alias" | "as">): void;
  until(what: string, ok: () => boolean | Promise<boolean>, ms?: number): Promise<void>;
  readAll(): Promise<void>;
  seat(): Promise<Awaited<ReturnType<typeof daemonListening>>[number] | undefined>;
  quiet(): Promise<number>;
  stopRelay(): void;
  startRelayAgain(): void;
  stopDaemon(): Promise<void>;
}

export function wakeHarness(): WakeHarness {
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
  let ownerCh: Channel | undefined;
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

  const until = async (what: string, ok: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> => {
    const end = Date.now() + ms;
    while (!(await ok())) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await Bun.sleep(50);
    }
  };

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

  return {
    home,
    bin,
    wakeLog,
    doneLog,
    heard,
    get ownerCh() {
      if (!ownerCh) throw new Error("the wake harness hasn't started");
      return ownerCh;
    },
    get relay() {
      return relay;
    },
    get claudePk() {
      return claudePk;
    },
    fake,
    calls,
    bindAs,
    until,
    readAll,
    seat,
    quiet,
    stopRelay: () => server?.stop(true),
    startRelayAgain: () => {
      server = startRelay({ port, hostname: "127.0.0.1", dataDir });
    },
    stopDaemon: async () => {
      await daemon?.stop();
      daemon = undefined;
    },
  };
}
