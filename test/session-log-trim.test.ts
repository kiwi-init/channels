import { afterAll, beforeAll, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import { AgentSession, runAgent } from "../src/agent.ts";
import { Channel } from "@kiwi/core/client.ts";
import { generateIdentity, type Identity } from "@kiwi/core/identity.ts";
import type { Message } from "@kiwi/core/protocol.ts";
import type { ChannelState, FoldBase } from "@kiwi/core/state.ts";
import { Cursor, saveConfig, saveIdentity, type ChannelConfig } from "../src/config.ts";
import { startRelay } from "../src/relay/bun.ts";

setDefaultTimeout(240_000);

const SENDERS = 10;
const home = mkdtempSync(join(tmpdir(), "kiwi-log-trim-"));
const dataDir = mkdtempSync(join(tmpdir(), "kiwi-log-trim-relay-"));
const prevHome = process.env.KIWI_HOME;
process.env.KIWI_HOME = home;

let server: ReturnType<typeof startRelay> | undefined;
let ownerCh: Channel;
let senders: Channel[] = [];
let cfg: ChannelConfig;
let early = { task: 0, root: 0, reply: 0, room: "" };

const logOf = (s: AgentSession): Message[] => (Reflect.get(s, "log") as Message[] | null) ?? [];
const baseOf = (s: AgentSession): number => (Reflect.get(s, "base") as FoldBase | null)?.n ?? 0;

async function burst(each: number, tag: string): Promise<void> {
  await Promise.all(
    senders.map(async (ch, i) => {
      for (let k = 0; k < each; k++) await ch.send(`${tag} ${i}.${k}`);
    }),
  );
}

function plain(x: unknown): unknown {
  if (x instanceof Map) return [...x].map(([k, v]) => [k, plain(v)]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
  if (x instanceof Set) return [...x].map(String).sort();
  if (Array.isArray(x)) return x.map(plain);
  if (x && typeof x === "object")
    return Object.fromEntries(
      Object.entries(x)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, plain(v)]),
    );
  return x;
}

function contiguous(s: AgentSession): void {
  const seqs = logOf(s)
    .map((m) => m.seq)
    .filter((seq) => seq > baseOf(s));
  expect(seqs[0]).toBe(baseOf(s) + 1);
  expect(seqs).toEqual(seqs.map((_, i) => baseOf(s) + 1 + i));
}

const below = (s: AgentSession): number[] =>
  logOf(s)
    .map((m) => m.seq)
    .filter((seq) => seq <= baseOf(s));

const setCursor = (seq: number): Promise<void> =>
  runAgent(
    Effect.gen(function* () {
      yield* (yield* Cursor).write("test", "claude", seq);
    }),
  );

const wakeSeqs = async (s: AgentSession): Promise<number[]> => {
  const { messages, state } = await runAgent(s.state());
  return (await runAgent(s.unreadAt(state, messages))).seqs;
};

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir, devNoRateLimits: true });
  const relay = server.url.origin;
  const owner = await generateIdentity("human");
  const reader = await generateIdentity("claude");
  const ids: Identity[] = [];
  for (let i = 0; i < SENDERS; i++) ids.push(await generateIdentity(`s${i}`));
  const made = await Channel.create(relay, owner, { name: "human" }, [{ ...reader, info: { name: "claude" } }, ...ids.map((s) => ({ ...s, info: { name: s.name } }))]);
  ownerCh = new Channel(made.access, relay, owner);
  early = {
    task: await ownerCh.send("early task", { kind: "event", ev: { op: "task.add", title: "a task from early on" } }),
    root: await ownerCh.send("an early question"),
    reply: 0,
    room: "",
  };
  early.reply = await ownerCh.send("an early answer", { re: [early.root] });
  early.room = await ownerCh.makeRoom("early room", [{ name: "claude", pk: reader.pk, xpk: reader.xpk ?? "" }]);
  await ownerCh.send("said in the early room", { room: early.room });
  await ownerCh.send("charter", { kind: "event", ev: { op: "charter.set", text: "the charter from early on" } });
  senders = await Promise.all(ids.map(async (s) => new Channel(await Channel.resume(relay, made.code, s), relay, s)));
  cfg = { ...(await Channel.resume(relay, made.code, reader)), relay, code: made.code, as: "claude" };
  saveConfig({ channels: { test: cfg } });
  saveIdentity(reader, made.access.roomId);
});

afterAll(() => {
  server?.stop(true);
  if (prevHome === undefined) delete process.env.KIWI_HOME;
  else process.env.KIWI_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

test("a long-lived session drops the messages its fold base covers, folds the same, and still finds older messages and threads", async () => {
  await burst(90, "first");
  const session = await AgentSession.open("test", cfg, "claude");
  setSystemTime(new Date(Date.now()));
  const before = (await runAgent(session.state())).state;
  expect(logOf(session).length).toBeLessThanOrEqual(800);
  expect(baseOf(session)).toBeGreaterThan(early.reply);
  contiguous(session);
  const after = await runAgent(session.state());
  setSystemTime();
  expect(plain(after.state)).toEqual(plain(before));
  expect(after.state.tasks.get(early.task)?.title).toBe("a task from early on");
  expect(after.state.charter?.text).toBe("the charter from early on");
  expect(after.state.rooms.get(early.room)?.name).toBe("early room");

  expect((await runAgent(session.message(early.root, after.messages)))?.body).toBe("an early question");
  const late = await ownerCh.send("a late answer", { re: [early.reply] });
  const now = await runAgent(session.state());
  const thread = await runAgent(session.threadMessages(early.root, now.messages, now.state));
  expect(thread.map((m) => m.seq)).toEqual([early.root, early.reply, late]);

  const firstBase = baseOf(session);
  for (let cycle = 0; cycle < 2; cycle++) {
    const was = baseOf(session);
    await burst(55, `cycle${cycle}`);
    await runAgent(session.state());
    expect(baseOf(session)).toBeGreaterThan(was);
    expect(logOf(session).length).toBeLessThanOrEqual(800);
    contiguous(session);
  }
  expect(baseOf(session)).toBeGreaterThan(firstBase);
});

test("a message arriving while two looks trim at once leaves no hole and no repeat", async () => {
  const session = await AgentSession.open("test", cfg, "claude");
  await runAgent(session.state());
  const was = baseOf(session);
  await burst(90, "racing");
  const [, , sent] = await Promise.all([runAgent(session.state()), runAgent(session.state()), ownerCh.send("sent during the trim")]);
  const { messages, state }: { messages: Message[]; state: ChannelState } = await runAgent(session.state());
  expect(baseOf(session)).toBeGreaterThan(was);
  contiguous(session);
  expect(messages.some((m) => m.seq === sent)).toBe(true);
  expect(state.head).toBe(sent);
});

test("an unread mention and a direct message below the new base still wake the seat and are delivered, until they are read", async () => {
  const session = await AgentSession.open("test", cfg, "claude");
  await runAgent(session.state());
  const mention = await ownerCh.send("@claude are you there?");
  const direct = await ownerCh.send("just for claude", { to: ["claude"] });
  await setCursor(mention - 1);
  await burst(90, "unread");
  const head = await ownerCh.send("the last one");
  for (let look = 0; look < 3; look++) {
    const seqs = await wakeSeqs(session);
    expect(seqs).toContain(mention);
    expect(seqs).toContain(direct);
  }
  expect(baseOf(session)).toBeGreaterThan(direct);
  expect(below(session)).toContain(mention);
  expect(below(session)).toContain(direct);
  contiguous(session);

  const got = await runAgent(session.unread());
  expect(got.messages.map((m) => m.seq)).toEqual(expect.arrayContaining([mention, direct]));
  await runAgent(got.commit());
  expect(await wakeSeqs(session)).not.toContain(mention);

  await burst(90, "after reading");
  await runAgent(session.state());
  expect(below(session)).not.toContain(mention);
  expect(below(session)).not.toContain(direct);
  expect(below(session).every((seq) => seq > head)).toBe(true);
  contiguous(session);
});

test("past 800 unread below the base, the oldest unread are paged back from the relay, across repeated trims, until read", async () => {
  const session = await AgentSession.open("test", cfg, "claude");
  await runAgent(session.state());
  const mention = await ownerCh.send("@claude still there?");
  const direct = await ownerCh.send("for claude, from long ago", { to: ["claude"] });
  await setCursor(mention - 1);
  const bases: number[] = [];
  for (let round = 0; round < 3; round++) {
    await burst(90, `far behind ${round}`);
    const seqs = await wakeSeqs(session);
    expect(seqs).toContain(mention);
    expect(seqs).toContain(direct);
    bases.push(baseOf(session));
    contiguous(session);
  }
  expect(bases[2]).toBeGreaterThan(bases[0] ?? 0);
  expect(below(session).length).toBeLessThanOrEqual(800);
  expect(below(session)).not.toContain(mention);
  expect(below(session)).not.toContain(direct);

  const got = await runAgent(session.unread({ all: true }));
  const delivered = got.messages.map((m) => m.seq);
  expect(delivered[0]).toBe(mention);
  expect(delivered).toContain(direct);
  expect(delivered).toEqual([...delivered].sort((a, b) => a - b));
  expect(new Set(delivered).size).toBe(delivered.length);
  await runAgent(got.commit());
  const after = await wakeSeqs(session);
  expect(after).not.toContain(mention);
  expect(after).not.toContain(direct);
});

test("unread paged back across relay pages cut short by their byte limit are all counted and delivered, in order", async () => {
  const session = await AgentSession.open("test", cfg, "claude");
  const start = (await runAgent(session.state())).state.head;
  await setCursor(start);
  for (let i = 0; i < 70; i++) await ownerCh.send(randomBytes(66_000).toString("base64"));
  const mention = await ownerCh.send("@claude after the large bodies");
  const direct = await ownerCh.send("for claude, after the large bodies", { to: ["claude"] });
  await burst(180, "after large");
  const head = await ownerCh.send("the newest");
  const seqs = await wakeSeqs(session);
  expect(below(session)).not.toContain(mention);
  expect((await session.ch.page(start, 1000)).length).toBeLessThan(70);
  expect(seqs).toContain(mention);
  expect(seqs).toContain(direct);

  const got = await runAgent(session.unread({ all: true }));
  expect(got.messages.map((m) => m.seq)).toEqual(Array.from({ length: head - start }, (_, i) => start + 1 + i));
  await runAgent(got.commit());
  const after = await wakeSeqs(session);
  expect(after).not.toContain(mention);
  expect(after).not.toContain(direct);
});
