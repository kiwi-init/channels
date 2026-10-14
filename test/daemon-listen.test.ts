// The daemon multiplexes one relay stream per agent seat (src/daemon.ts): every subscriber of
// an agent shares its seat's stream, each from its own cursor; a restart only needs the cursors.
// Against a real relay (startRelay), with the seat's home written the way a join would.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Channel } from "../src/client.ts";
import { loadConfig, saveConfig, saveIdentity } from "../src/config.ts";
import { daemonListening, listenDaemon, startDaemon, type Daemon, type DaemonEvent, type DaemonSubscription } from "../src/daemon.ts";
import { generateIdentity } from "../src/identity.ts";
import type { Message, Presence } from "../src/protocol.ts";
import { checked } from "./check.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(30_000);

const home = mkdtempSync(join(tmpdir(), "kiwi-daemon-listen-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-daemon-listen-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay> | undefined;
let relay = "";
let ownerCh: Channel;
let daemon: Daemon | undefined;
let code = "";
let roomId = "";
let agentPk = "";

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
  const owner = await generateIdentity("human");
  const agent = await generateIdentity("claude");
  const made = await Channel.create(relay, owner, { name: "human" }, [{ ...agent, info: { name: "claude" } }]);
  ownerCh = new Channel(made.access, relay, owner);
  code = made.code;
  roomId = made.access.roomId;
  agentPk = agent.pk;
  // The seat's home, the way a join leaves it: the channel config and the agent's key.
  saveConfig({ channels: { test: { ...(await Channel.resume(relay, made.code, agent)), relay, code: made.code, as: "claude" } } });
  saveIdentity(agent, made.access.roomId);
  daemon = await startDaemon();
});
afterAll(async () => {
  await daemon?.stop().catch(() => {});
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

/** The next delivery, failing at the deadline instead of hanging the file. */
async function nextMsg(it: AsyncIterator<Message>, label: string, ms = 10_000): Promise<Message> {
  const got = await Promise.race([it.next(), Bun.sleep(ms).then(() => null)]);
  if (!got || got.done) throw new Error(`timed out waiting for ${label}`);
  return got.value;
}

/** Collect until a delivery with this body arrives (the seat's history may hold older ones). */
async function waitBody(sub: DaemonSubscription, body: string): Promise<Message> {
  const it = sub[Symbol.asyncIterator]();
  const end = Date.now() + 10_000;
  for (;;) {
    const m = await nextMsg(it, `"${body}"`, Math.max(500, end - Date.now()));
    if (m.body === body) return m;
  }
}

/** How far the tests have consumed: each test resumes from where the last one got to. */
let cursor = 0;

describe("the daemon's shared listening", () => {
  test("two subscribers share one agent's stream, each from its cursor", async () => {
    // At once, so the daemon opens the seat's relay stream only once for both.
    const [a, b] = await Promise.all([listenDaemon("test", "claude", cursor), listenDaemon("test", "claude", cursor)]);
    try {
      expect(await daemonListening()).toEqual([{ channel: "test", agent: "claude", subscribers: 2 }]);
      const seq = await ownerCh.send("hello agents");
      expect((await waitBody(a, "hello agents")).seq).toBe(seq);
      expect((await waitBody(b, "hello agents")).seq).toBe(seq);
      cursor = seq;
    } finally {
      b.close();
    }
    // The close travels over the socket; poll instead of assuming it landed.
    const end = Date.now() + 5_000;
    while ((await daemonListening()).length !== 1) {
      if (Date.now() > end) throw new Error("timed out waiting for the unsubscribe to land");
      await Bun.sleep(50);
    }
    a.close();
  });

  test("a resubscriber gets only what it missed", async () => {
    const a = await listenDaemon("test", "claude", cursor);
    try {
      const c = await listenDaemon("test", "claude", cursor);
      try {
        await ownerCh.send("second");
        await ownerCh.send("third");
        // Still subscribed from the start, `a` hears both too.
        expect((await waitBody(a, "second")).body).toBe("second");
        const it = c[Symbol.asyncIterator]();
        // Resumed from the first message, `c` starts at the second: nothing replayed, nothing missed.
        expect((await nextMsg(it, "second")).body).toBe("second");
        cursor = (await nextMsg(it, "third")).seq;
        expect(cursor).toBeGreaterThan(0);
      } finally {
        c.close();
      }
    } finally {
      a.close();
    }
  });

  test("a fresh daemon serves a reconnecting subscriber from its cursor", async () => {
    await ownerCh.send("before the restart");
    await daemon!.stop();
    await ownerCh.send("while down");
    daemon = await startDaemon();
    expect(await daemonListening()).toEqual([]);
    const d = await listenDaemon("test", "claude", cursor);
    try {
      const it = d[Symbol.asyncIterator]();
      // Both messages landed while no daemon ran; the catch-up replays them from the cursor, in order.
      expect((await nextMsg(it, "before the restart")).body).toBe("before the restart");
      expect((await nextMsg(it, "while down")).body).toBe("while down");
      expect(await daemonListening()).toEqual([{ channel: "test", agent: "claude", subscribers: 1 }]);
    } finally {
      d.close();
    }
  });

  test("the iterator's return() unsubscribes and closes the unix socket", async () => {
    const sub = await listenDaemon("test", "claude", cursor);
    expect(await daemonListening()).toEqual([{ channel: "test", agent: "claude", subscribers: 1 }]);
    await sub[Symbol.asyncIterator]().return?.();
    const end = Date.now() + 5_000;
    while ((await daemonListening()).length !== 0) {
      if (Date.now() > end) throw new Error("timed out waiting for return() to unsubscribe");
      await Bun.sleep(50);
    }
  });
});

async function until(what: string, ok: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

async function noSeats(): Promise<void> {
  await until("every seat to close", async () => (await daemonListening()).length === 0);
}

describe("the daemon's seat does what a listener does (T332)", () => {
  beforeAll(async () => {
    await noSeats();
    await daemon?.stop();
    daemon = await startDaemon(undefined, { beaconMs: 300 });
  });

  test("it announces what a subscriber says, keeps a beacon, and answers a probe", async () => {
    const heard: (Presence & { sigOk: boolean })[] = [];
    let probe: ((p: { client: string; query: boolean }) => Promise<void>) | null = null;
    const ctl = new AbortController();
    void ownerCh.stream(await ownerCh.head(), () => {}, { signal: ctl.signal, onPresence: (p) => heard.push(p), onOpen: ({ presence }) => (probe = presence) });
    const sub = await listenDaemon("test", "claude", cursor);
    try {
      await sub.presence({ client: "tail", role: "coder" });
      const fromAgent = () => heard.filter((p) => p.pk === agentPk && !p.query);
      await until("the announce", () => fromAgent().some((p) => p.client === "tail" && p.role === "coder"));
      const before = fromAgent().length;
      await until("a beacon", () => fromAgent().length >= before + 2);
      await until("the owner's socket", () => probe !== null);
      const n = fromAgent().length;
      await probe!({ client: "probe", query: true });
      await until("an answer to the probe", () => fromAgent().length > n, 3_000);
    } finally {
      sub.close();
      ctl.abort();
    }
    await noSeats();
  });

  test("roster events reach subscribers, and a messages-only subscriber still gets messages", async () => {
    const events: DaemonEvent[] = [];
    const sub = await listenDaemon("test", "claude", cursor, { onEvent: (e) => events.push(e) });
    const plain = await listenDaemon("test", "claude", cursor);
    try {
      await until("the open event", () => events.includes("open"));
      const joiner = await generateIdentity("gemini");
      const ask = await Channel.requestJoin(relay, code, joiner, { name: "gemini" });
      await ownerCh.approve((await checked(ownerCh, relay, code, [{ id: joiner, requestId: ask.requestId }]))[0]!);
      await until("the roster event", () => events.includes("roster"));
      const seq = await ownerCh.send("after the roster");
      expect((await waitBody(plain, "after the roster")).seq).toBe(seq);
      cursor = seq;
    } finally {
      sub.close();
      plain.close();
    }
    await noSeats();
  });

  test("read marks go out only when a subscriber asks", async () => {
    const markOf = (): number | null => {
      const db = new Database(join(dataDir, `${roomId}.sqlite`), { readonly: true });
      try {
        return (db.query("SELECT seq FROM reads WHERE pk = ?").get(agentPk) as { seq: number } | null)?.seq ?? null;
      } finally {
        db.close();
      }
    };
    const before = markOf();
    const sub = await listenDaemon("test", "claude", cursor);
    try {
      const seq = await ownerCh.send("read me");
      await waitBody(sub, "read me");
      await Bun.sleep(1_500);
      expect(markOf()).toBe(before);
      await sub.mark(seq);
      await until("the read mark", () => markOf() === seq);
      cursor = seq;
    } finally {
      sub.close();
    }
    await noSeats();
  });

  test("a seat opened while the relay is down waits for it, and says so", async () => {
    const port = Number(server!.url.port);
    server!.stop(true);
    const statuses: string[] = [];
    const pending = listenDaemon("test", "claude", cursor, { onStatus: (s) => statuses.push(s) });
    await Bun.sleep(1_000);
    server = startRelay({ port, hostname: "127.0.0.1", dataDir });
    const sub = await pending;
    try {
      expect(statuses.some((s) => s.startsWith("can't reach the relay"))).toBe(true);
      expect(statuses.some((s) => s.startsWith("reached the relay"))).toBe(true);
      const seq = await ownerCh.send("back again");
      expect((await waitBody(sub, "back again")).seq).toBe(seq);
      cursor = seq;
    } finally {
      sub.close();
    }
    await noSeats();
  });

  test("a key rotation is saved for the agent", async () => {
    const sub = await listenDaemon("test", "claude", cursor);
    try {
      const epoch = await ownerCh.rotate();
      const seq = await ownerCh.send("under the new key");
      expect((await waitBody(sub, "under the new key")).seq).toBe(seq);
      await until("the saved key", () => !!loadConfig().channels.test?.keys[String(epoch)]);
      cursor = seq;
    } finally {
      sub.close();
    }
    await noSeats();
  });
});
