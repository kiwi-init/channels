// Read receipts (T1554): a member tells the relay how far it has read, the relay keeps one mark per
// key (a seq and a time, never content) and passes each to every client, and an agent marks as kiwi
// hands it messages.
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { AgentLive } from "../src/agent.ts";
import { Channel } from "../src/client.ts";
import { generateIdentity } from "../src/identity.ts";
import type { ReadMark } from "../src/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(60_000);

const MC = ["bun", join(import.meta.dir, "../src/cli/main.ts")];
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-reads-relay-"));
const made: string[] = [dataDir];
let server: ReturnType<typeof startRelay> | undefined;
let relay = "";
beforeAll(() => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  relay = server.url.origin;
});
afterAll(() => {
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const runIt = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>);

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 15_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

/** The relay's marks for one room, straight from its file. */
function stored(roomId: string): { pk: string; seq: number }[] {
  const db = new Database(join(dataDir, `${roomId}.sqlite`), { readonly: true });
  try {
    return db.query("SELECT pk, seq FROM reads ORDER BY pk").all() as { pk: string; seq: number }[];
  } finally {
    db.close();
  }
}

/** Every read mark a live view of `ch` hears, until the returned stop. */
function hear(ch: Channel): { marks: ReadMark[]; stop: () => void } {
  const marks: ReadMark[] = [];
  const fiber = Effect.runFork(
    Stream.runForEach(ch.fx.live(0, { presence: false }), (ev) => Effect.sync(() => void (ev._tag === "Read" && marks.push(...ev.reads)))).pipe(Effect.provide(AgentLive)) as Effect.Effect<void>,
  );
  return { marks, stop: () => void Effect.runFork(Fiber.interrupt(fiber)) };
}

describe("the relay's read marks", () => {
  test("only forward, never past the head; heard live, and again on connect", async () => {
    const owner = await generateIdentity("human");
    const { access } = await Channel.create(relay, owner, { name: "human" });
    const writer = new Channel(access, relay, owner);
    const a = await writer.send("one");
    const b = await writer.send("two");

    const live = hear(new Channel(access, relay, owner));
    await Bun.sleep(300);
    await runIt(writer.fx.markRead(a));
    await until(() => live.marks.some((r) => r.pk === owner.pk && r.seq === a), "the mark, live");
    // Past the head, it's kept at the head.
    await runIt(writer.fx.markRead(b + 100));
    expect(stored(access.roomId)).toEqual([{ pk: owner.pk, seq: b }]);
    // Going back changes nothing (a fresh client, so this reaches the relay).
    await runIt(new Channel(access, relay, owner).fx.markRead(a));
    expect(stored(access.roomId)).toEqual([{ pk: owner.pk, seq: b }]);
    live.stop();

    // A view connecting now is told how far everyone has read before it's caught up.
    const later = hear(new Channel(access, relay, owner));
    await until(() => later.marks.some((r) => r.pk === owner.pk && r.seq === b), "the marks on connect");
    later.stop();
  });

  test("a relay that doesn't know read marks is asked once, and nothing fails", async () => {
    const owner = await generateIdentity("human");
    const { access } = await Channel.create(relay, owner, { name: "human" });
    // Not a relay at all, as far as read marks go: every path answers "not found".
    const old = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ error: "not found", tag: "NotFound" }, { status: 404 }) });
    try {
      let asked = 0;
      const counting = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => (asked++, fetch(new Request(old.url.origin + new URL(req.url).pathname, req))) });
      const ch = new Channel(access, counting.url.origin, owner);
      await runIt(ch.fx.markRead(1));
      await runIt(ch.fx.markRead(2));
      expect(asked).toBe(1);
      counting.stop(true);
    } finally {
      old.stop(true);
    }
  });
});

describe("agents mark as kiwi hands them messages", () => {
  const scratch = (tag: string) => {
    const d = mkdtempSync(join(tmpdir(), `kiwi-reads-${tag}-`));
    made.push(d);
    return d;
  };
  const owner = scratch("owner");
  const agent = scratch("agent");
  function spawn(home: string, args: string[], env: Record<string, string> = {}, input?: string) {
    return Bun.spawn([...MC, ...args], {
      cwd: home,
      env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1", KIWI_MODEL: "test-model", ...env },
      stdin: input === undefined ? "ignore" : new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    });
  }
  async function ok(home: string, ...args: string[]): Promise<string> {
    return okWith(home, args);
  }
  async function okWith(home: string, args: string[], env: Record<string, string> = {}, input?: string): Promise<string> {
    const p = spawn(home, args, env, input);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    if ((await p.exited) !== 0) throw new Error(`kiwi ${args.join(" ")}: ${err}`);
    return out;
  }
  const seqOf = (out: string) => Number(/#(\d+)/.exec(out)![1]);
  let roomId = "";
  const readUpTo = () => Math.max(0, ...stored(roomId).map((r) => r.seq));

  beforeAll(async () => {
    const before = new Set(readdirSync(dataDir));
    const code = /join code: (\S+)/.exec(await ok(owner, "create", "reads", "--as", "lead", "--open"))![1]!;
    roomId = readdirSync(dataDir).find((f) => !before.has(f) && /^[0-9a-f]{32}\.sqlite$/.test(f))!.slice(0, 32);
    const p = spawn(agent, ["join", code, "--as", "dev"]);
    let listed = "";
    await until(async () => /\d{3}-\d{3}/.test((listed = await ok(owner, "--as", "human", "requests"))), "request");
    await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
    expect(await p.exited).toBe(0);
    await ok(agent, "listen", "--now");
  });

  test("listen --now: what it printed is read", async () => {
    const sent = seqOf(await ok(owner, "send", "--to", "dev", "ping"));
    expect(readUpTo()).toBeLessThan(sent);
    expect(await ok(agent, "listen", "--now")).toContain("ping");
    expect(readUpTo()).toBeGreaterThanOrEqual(sent);
  });

  test("its own messages don't move its mark", async () => {
    const before = readUpTo();
    const mine = seqOf(await ok(agent, "send", "--to", "lead", "from dev itself"));
    await ok(agent, "listen", "--now");
    expect(readUpTo()).toBe(before);
    expect(mine).toBeGreaterThan(before);
  });

  test("the listen stream says it on its socket, while it runs", async () => {
    const stream = spawn(agent, ["listen"]);
    try {
      await Bun.sleep(800);
      const sent = seqOf(await ok(owner, "send", "--to", "dev", "streamed"));
      await until(() => readUpTo() >= sent, "the mark from the stream");
    } finally {
      stream.kill();
    }
  });

  test("a Claude Code session's next hook commits what the listener handed it, and marks it read", async () => {
    const S = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "hooked", CLAUDE_PID: String(process.pid) };
    await okWith(agent, ["use", "reads", "--as", "dev"], S);
    const sent = seqOf(await ok(owner, "send", "--to", "dev", "handed by the listener"));
    // What the background listener leaves behind when it hands a message to the session.
    mkdirSync(join(agent, "listen-hooks"), { recursive: true });
    writeFileSync(join(agent, "listen-hooks", "reads.dev.hooked.delivered"), String(sent));
    expect(readUpTo()).toBeLessThan(sent);
    const out = await okWith(agent, ["hook", "prompt"], S, JSON.stringify({ session_id: "hooked", cwd: realpathSync(agent) }));
    // Committed, so not handed over again; and read.
    expect(out).not.toContain("handed by the listener");
    expect(readUpTo()).toBeGreaterThanOrEqual(sent);
  });

  test("an MCP wait marks what it returned", async () => {
    const p = Bun.spawn([...MC, "mcp"], { cwd: agent, env: { ...process.env, KIWI_HOME: agent, KIWI_RELAY: relay, KIWI_NO_HOOKS: "1", KIWI_CHANNEL: "reads", KIWI_AS: "dev" }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    try {
      const reader = p.stdout.getReader();
      let buf = "";
      let id = 0;
      const rpc = async (method: string, params: object = {}) => {
        const myId = ++id;
        p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
        p.stdin.flush();
        for (;;) {
          const nl = buf.indexOf("\n");
          if (nl >= 0) {
            const msg = JSON.parse(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
            if (msg.id === myId) return msg.result ?? msg.error;
            continue;
          }
          const { value, done } = await reader.read();
          if (done) throw new Error("mcp exited");
          buf += new TextDecoder().decode(value);
        }
      };
      await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } });
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      const waiting = rpc("tools/call", { name: "wait_for_messages", arguments: { timeout_seconds: 20 } });
      await Bun.sleep(1000);
      const sent = seqOf(await ok(owner, "send", "--to", "dev", "for the mcp wait"));
      const got = (await waiting) as { content: { text: string }[] };
      expect(got.content[0]!.text).toContain("for the mcp wait");
      await until(() => readUpTo() >= sent, "the mark after the wait");
    } finally {
      p.kill();
    }
  });

  test("listen --once: marked before it exits", async () => {
    const waiting = spawn(agent, ["listen", "--once", "--timeout", "20s"]);
    await Bun.sleep(800);
    const sent = seqOf(await ok(owner, "send", "--to", "dev", "once more"));
    expect(await waiting.exited).toBe(0);
    expect(readUpTo()).toBeGreaterThanOrEqual(sent);
  });
});
