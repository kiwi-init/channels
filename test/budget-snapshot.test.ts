import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSession, runAgent, type AgentSession } from "../src/agent.ts";
import { signRequest } from "@kiwi/core/auth.ts";
import { loadConfig } from "../src/config.ts";
import { openOwnerSession } from "../src/owner.ts";
import type { Event } from "@kiwi/core/protocol.ts";
import { startRelay } from "../src/relay/bun.ts";
import { sealSnapshot } from "@kiwi/core/snapshot.ts";
import { fold, type ChannelState, type FoldBase } from "@kiwi/core/state.ts";
import { kiwiCmd } from "./owner.ts";
import { sum, trafficProxy, type Traffic } from "./traffic.ts";

setDefaultTimeout(300_000);

const MESSAGES = 3000;
const BUDGET = { http: 7, bytesDown: 0.1 };

const made: string[] = [];
const scratch = (tag: string) => {
  const d = mkdtempSync(join(tmpdir(), `kiwi-snap-${tag}-`));
  made.push(d);
  return d;
};
const dataDir = scratch("relay");
const owner = scratch("owner");
const agent = scratch("agent");
let server: ReturnType<typeof startRelay> | undefined;
let proxy: ReturnType<typeof trafficProxy> | undefined;
let alias = "";
let roomId = "";

function spawn(home: string, args: string[]) {
  return Bun.spawn(kiwiCmd(args), {
    cwd: home,
    env: { ...process.env, KIWI_HOME: home, KIWI_RELAY: proxy!.url, KIWI_NO_HOOKS: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function ok(home: string, ...args: string[]): Promise<string> {
  const p = spawn(home, args);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  if (code !== 0) throw new Error(`kiwi ${args.join(" ")} exited ${code}: ${err}`);
  return out;
}

async function until(pred: () => Promise<boolean>, label: string, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await Bun.sleep(50);
  }
}

function inHome<A>(home: string, run: () => Promise<A>): Promise<A> {
  process.env.KIWI_HOME = home;
  return run();
}

const session = (home: string, name: string) => inHome(home, () => runAgent(openSession(alias, loadConfig().channels[alias]!, name)));

const coldCache = () => rmSync(join(agent, "cache"), { recursive: true, force: true });

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

async function fullFold(s: AgentSession): Promise<ChannelState> {
  const { messages } = await s.ch.history(0);
  const roster = await runAgent(s.members(true));
  return fold(messages, roster, Date.now(), await s.ch.rooms(), await s.ch.guard());
}

const measure = async (label: string, run: () => Promise<unknown>): Promise<Traffic> => {
  await Bun.sleep(100);
  proxy!.reset();
  await run();
  await Bun.sleep(200);
  const t = proxy!.reset();
  console.log(`${label}: ${t.http} http ${JSON.stringify(t.routes)}, ${t.sockets} sockets, ${sum(t.framesDown)} frames down, ${t.bytesUp} B up, ${t.bytesDown} B down`);
  return t;
};

beforeAll(async () => {
  server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir });
  proxy = trafficProxy(server.url.origin);
  const code = /join code: (\S+)/.exec(await ok(owner, "create", "snap", "--as", "lead", "--open"))![1]!;
  const joining = spawn(agent, ["join", code, "--as", "dev"]);
  let listed = "";
  await until(async () => {
    listed = await ok(owner, "--as", "human", "requests");
    return /\d{3}-\d{3}/.test(listed);
  }, "request");
  await ok(owner, "--as", "human", "approve", /(\d{3}-\d{3})/.exec(listed)![1]!, "--yes");
  expect(await joining.exited).toBe(0);
  process.env.KIWI_HOME = owner;
  alias = Object.keys(loadConfig().channels)[0]!;
  roomId = loadConfig().channels[alias]!.roomId;

  const lead = await session(owner, "lead");
  const human = await session(owner, "human");
  const start = Date.now() + 2 * 60_000;
  const tasks: number[] = [];
  let lastChat = 0;
  for (let i = 0; i < MESSAGES; i++) {
    if (i % 100 === 0) setSystemTime(new Date(start + (i / 100) * 61_000));
    const text = `message ${i}: ${"the quick brown fox jumps over the lazy dog ".repeat(1 + (i % 4))}`;
    const event = (ch: AgentSession, ev: Event) => ch.ch.send(text.slice(0, 60), { kind: "event", ev });
    const k = i % 10;
    if (i === 500) await event(human, { op: "room.create", id: "ops", name: "ops" });
    else if (i === 1000) await event(human, { op: "charter.set", text: "ship the budget" });
    else if (k === 0) tasks.push(await event(lead, { op: "task.add", title: `task ${i}` }));
    else if (k === 1 && tasks.length) await event(lead, { op: "task.update", task: tasks.at(-1)!, state: i % 20 === 1 ? "doing" : "done", note: "progress" });
    else if (k === 2) await event(lead, { op: "fact.set", key: `k${i % 37}`, value: `v${i}` });
    else if (k === 3 && lastChat) await event(human, { op: "react", seq: lastChat, emoji: "👍" });
    else if (k === 4) lastChat = await human.ch.send(text, { kind: "ask", ...(i > 600 && i % 3 === 0 ? { room: "ops" } : {}) });
    else lastChat = await (i % 2 ? lead : human).ch.send(text, lastChat && i % 3 === 0 ? { re: [lastChat] } : {});
  }
  setSystemTime();
});

afterAll(() => {
  setSystemTime();
  proxy?.stop();
  server?.stop(true);
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe("a fresh agent's cold start with the owner's snapshot", () => {
  let before: Traffic;
  let after: Traffic;

  test("before: no snapshot, the whole log", async () => {
    coldCache();
    before = await measure("status, cold, no snapshot", () => ok(agent, "status"));
    expect(before.routes["GET /messages"]).toBeGreaterThanOrEqual(Math.ceil(MESSAGES / 1000));
  });

  test("the owner publishes a snapshot; only the owner may", async () => {
    const own = await inHome(owner, () => runAgent(openOwnerSession(alias, loadConfig().channels[alias]!, "human")));
    const n = await inHome(owner, () => runAgent(own.snapshot()));
    expect(n).toBeGreaterThanOrEqual(MESSAGES);
    const dev = await session(agent, "dev");
    const body = JSON.stringify({ snapshot: { n: 1, e: 0, iv: "A".repeat(16), ct: "x", hash: "h".repeat(43), sig: "s".repeat(86) } });
    const res = await fetch(`${server!.url.origin}/v1/rooms/${roomId}/snapshot`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${await signRequest(dev.identity, roomId, "PUT", "/snapshot", body)}` },
      body,
    });
    expect(res.status).toBe(403);
  });

  test("after: the snapshot and the tail past it", async () => {
    coldCache();
    after = await measure("status, cold, with snapshot", () => ok(agent, "status"));
    expect(after.routes["GET /snapshot"]).toBe(1);
    expect(after.routes["GET /messages"] ?? 0).toBeLessThanOrEqual(1);
    console.log(`cold status: ${before.http} -> ${after.http} http, ${before.bytesDown} -> ${after.bytesDown} B down`);
    expect(after.http).toBeLessThanOrEqual(BUDGET.http);
    expect(after.bytesDown).toBeLessThan(before.bytesDown * BUDGET.bytesDown);
  });

  test("the state folded from the snapshot is the state the whole log folds to", async () => {
    coldCache();
    const dev = await session(agent, "dev");
    const { messages, state } = await inHome(agent, () => runAgent(dev.state()));
    expect(messages.length).toBeLessThan(50);
    const full = await inHome(agent, async () => fullFold(dev));
    expect(state.tasks.size).toBe(MESSAGES / 10 - 2);
    expect([...state.members.keys()]).toEqual([...full.members.keys()]);
    expect(plain(state)).toEqual(plain(full));
    const again = await inHome(agent, () => runAgent(dev.state()));
    expect(plain(again.state)).toEqual(plain(full));
    const old = await inHome(agent, () => runAgent(dev.message(10, again.messages)));
    expect(old?.seq).toBe(10);
  });

  test("a snapshot signed by a member, planted by the relay, is never used", async () => {
    const dev = await session(agent, "dev");
    let made: FoldBase | undefined;
    await inHome(agent, async () => {
      const { messages } = await dev.ch.history(0);
      fold(messages, await runAgent(dev.members()), Date.now(), null, null, null, (b) => void (made = b));
    });
    if (!made) throw new Error("the fold made no base");
    const base = made;
    const evil = { ...base, facts: [{ key: "planted", value: "by a member", by: "human", ts: 1, seq: 1 }] };
    const sealed = await sealSnapshot(dev.identity, { ...dev.ch.access, ownerPk: dev.identity.pk }, evil);
    expect(sealed).not.toBeNull();
    const db = new Database(join(dataDir, `${roomId}.sqlite`));
    db.run("UPDATE meta SET v = ? WHERE k = 'snapshot'", [JSON.stringify({ ...sealed, at: Date.now() })]);
    db.close();
    coldCache();
    const t = await measure("status, cold, member-signed snapshot", () => ok(agent, "status"));
    expect(t.routes["GET /messages"]).toBeGreaterThanOrEqual(Math.ceil(MESSAGES / 1000));
    coldCache();
    const { state } = await inHome(agent, () => runAgent(dev.state()));
    expect(state.facts.has("planted")).toBe(false);
    expect(state.tasks.size).toBe(MESSAGES / 10 - 2);
  });
});
