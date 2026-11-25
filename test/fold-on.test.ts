import { afterEach, describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, type Event, type Message } from "@kiwi/core/protocol.ts";
import { fold, folded, type ChannelState, type FoldBase, type Roster } from "@kiwi/core/state.ts";
import { TrackedMap } from "@kiwi/core/state/tracked.ts";

const T0 = 1_700_000_000_000;
const SEC = 1_000;
const OWNER = "o".repeat(43);
const PAT = "p".repeat(43);
const WIN = "w".repeat(43);
const ANN = "a".repeat(43);
const PKS: Record<string, string> = { jow: OWNER, pat: PAT, win: WIN, ann: ANN };
const PEOPLE = ["jow", "pat"];
const AGENTS = ["win", "ann"];
const EVERYONE = [...PEOPLE, ...AGENTS];

const roster = (laterRole?: number): Roster => [
  { name: "jow", pk: OWNER, owner: true, at: 0, active: true, kind: "human" },
  { name: "pat", pk: PAT, owner: false, at: 0, active: true, kind: "human", scopes: ["post", "ask", "tasks", "facts"] },
  { name: "win", pk: WIN, owner: false, at: 0, active: true, kind: "agent", scopes: ["post", "ask", "tasks", "facts"] },
  {
    name: "ann",
    pk: ANN,
    owner: false,
    at: 0,
    active: true,
    kind: "agent",
    scopes: ["post", "ask", "tasks", "facts"],
    ...(laterRole ? { laterRole: { role: "lead", about: "leads now", since: laterRole } } : {}),
  },
];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Stream {
  messages: Message[];
  times: number[];
}

function stream(seed: number, length: number): Stream {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const messages: Message[] = [];
  const chats: Message[] = [];
  const asks: Message[] = [];
  const perms: Message[] = [];
  const tasks: number[] = [];
  const times: number[] = [];
  let ts = T0;
  const base = (seq: number, from: string, over: Partial<Message>): Message => ({
    v: PROTOCOL_VERSION,
    id: `s${seed}-m${seq}`,
    from,
    kind: "msg",
    body: `message ${seq}`,
    ts,
    rts: ts,
    seq,
    sigOk: true,
    pk: PKS[from],
    ...over,
  });
  const event = (seq: number, from: string, ev: Event): Message => base(seq, from, { kind: "event", body: "", ev });
  for (let seq = 1; seq <= length; seq++) {
    ts += Math.floor(r() * 40 * SEC) + SEC;
    times.push(ts);
    const roll = r();
    const from = pick(EVERYONE);
    let m: Message;
    if (roll < 0.22) m = base(seq, from, r() < 0.3 ? { room: "general", to: [pick(EVERYONE)] } : {});
    else if (roll < 0.32 && chats.length) {
      const parent = pick(chats);
      m = base(seq, from, { re: [parent.seq], ...(r() < 0.3 ? { side: true as const } : {}) });
    } else if (roll < 0.38 && tasks.length) m = base(seq, from, { task: pick(tasks) });
    else if (roll < 0.42) m = base(seq, from, { dm: true, to: [pick(EVERYONE.filter((n) => n !== from))] });
    else if (roll < 0.47 && chats.length) m = event(seq, from, { op: "react", seq: pick(chats).seq, emoji: r() < 0.2 ? null : pick(["👍", "🎉", "👀"]) });
    else if (roll < 0.51) {
      const agent = pick(AGENTS);
      m = base(seq, agent, { kind: r() < 0.5 ? "ask" : "blocking", to: ["jow"], ...(r() < 0.5 ? { esc: true as const } : {}), ...(tasks.length && r() < 0.5 ? { holds: [pick(tasks)] } : {}) });
      asks.push(m);
    } else if (roll < 0.56 && asks.length) m = base(seq, pick(PEOPLE), { re: [pick(asks).seq], body: pick(["yes", "no", "A"]) });
    else if (roll < 0.58) {
      m = base(seq, pick(AGENTS), { kind: "ask", to: ["jow"], permission: { tool: "Bash", command: "ls", cwd: "/", nonce: `n${seq}`, expiresAt: ts + 120 * SEC, canAllow: true } });
      perms.push(m);
    } else if (roll < 0.6 && perms.length) {
      const p = pick(perms);
      m = base(seq, "jow", { re: [p.seq], perm: { ask: p.permission!.nonce, by: "jow", of: p.from, allow: r() < 0.5 } });
    } else if (roll < 0.66) {
      m = event(seq, pick(["jow", "win", "pat"]), { op: "task.add", title: `task ${seq}` });
      tasks.push(seq);
    } else if (roll < 0.72 && tasks.length)
      m = event(seq, pick(EVERYONE), { op: "task.update", task: pick(tasks), ...(r() < 0.5 ? { state: pick(["doing", "review", "todo"] as const) } : { note: `note ${seq}` }) });
    else if (roll < 0.76) m = event(seq, from, { op: "fact.set", key: pick(["build", "deploy", "mood"]), value: `v${seq}`, ...(r() < 0.6 ? { ttl: 60 + Math.floor(r() * 120) } : {}) });
    else if (roll < 0.77) m = event(seq, from, { op: "fact.del", key: pick(["build", "deploy", "mood"]) });
    else if (roll < 0.8) m = event(seq, from, { op: "lease.take", name: pick(["build", "release"]), ttl: 60 + Math.floor(r() * 60) });
    else if (roll < 0.82) m = event(seq, from, { op: "lease.free", name: pick(["build", "release"]) });
    else if (roll < 0.85 && chats.length) {
      const target = pick(chats);
      m = event(seq, r() < 0.8 ? target.from : from, r() < 0.7 ? { op: "msg.edit", seq: target.seq, body: `edited ${seq}` } : { op: "msg.delete", seq: target.seq });
    } else if (roll < 0.865) m = event(seq, "jow", { op: "scope.set", member: "win", pk: WIN, scopes: r() < 0.5 ? ["post"] : ["post", "ask", "tasks", "facts"], wasLead: false });
    else if (roll < 0.875) m = event(seq, "jow", { op: "power.set", member: "pat", pk: PAT, power: pick(["answersDecisions", "addsAgents"] as const), on: r() < 0.5, was: false });
    else if (roll < 0.88) m = event(seq, "jow", { op: "member.gone", member: "ann", pk: ANN });
    else m = base(seq, from, { body: `chat ${seq} for @${pick(EVERYONE)}` });
    if (m.kind !== "event") chats.push(m);
    messages.push(m);
  }
  return { messages, times };
}

const plain = (x: unknown): unknown => {
  if (x instanceof Map) return { map: [...Map.prototype.entries.call(x)].map(([k, v]) => [plain(k), plain(v)]) };
  if (x instanceof Set) return { set: [...x].map(plain) };
  if (Array.isArray(x)) return x.map(plain);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v === undefined ? { undefined: true } : plain(v)]));
  return x;
};

const batches = (r: () => number, messages: Message[], from: number): Message[][] => {
  const out: Message[][] = [];
  for (let i = from; i < messages.length;) {
    const n = 1 + Math.floor(r() * 5);
    out.push(messages.slice(i, i + n));
    i += n;
  }
  return out;
};

interface Run {
  steps: number;
  refolds: number;
  misses: string[];
  differ: string | null;
}

function run(seed: number, length: number, opts: { laterRole?: number; trimAt?: number; check?: boolean } = {}): Run {
  const r = rng(seed * 7 + 1);
  const { messages, times } = stream(seed, length);
  const people = roster(opts.laterRole);
  const start = 1 + Math.floor(r() * 10);
  let base: FoldBase | null = null;
  let held = messages.slice(0, start);
  let now = times[start - 1]!;
  let f = folded(held, people, now, null, null, null, true);
  const kept: { state: ChannelState; was: string }[] = [];
  const out: Run = { steps: 0, refolds: 0, misses: [], differ: null };
  const compare = (state: ChannelState, at: number) => {
    const oracle = fold(held, people, at, null, null, base);
    const a = JSON.stringify(plain(state));
    const b = JSON.stringify(plain(oracle));
    if (a !== b && !out.differ) out.differ = `seed ${seed} at #${held.at(-1)?.seq} (now ${at - T0})`;
    if (opts.check !== false) expect(plain(state)).toEqual(plain(oracle));
    kept.push({ state, was: a });
  };
  compare(f.state, now);
  for (const batch of batches(r, messages, start)) {
    const end = batch.at(-1)!.seq;
    now = times[end - 1]! + (r() < 0.2 ? Math.floor(r() * 400 * SEC) : 0);
    held = [...held, ...batch];
    if (opts.trimAt !== undefined && base === null && end >= opts.trimAt) {
      const cut = held.length - 5;
      let next: FoldBase | null = null;
      fold(held.slice(0, cut), people, now, null, null, null, (b) => void (next = b));
      base = next;
      held = held.slice(cut);
      f = folded(held, people, now, null, null, base, true);
      out.refolds++;
      compare(f.state, now);
      continue;
    }
    const state = f.next(batch, now);
    if (state) out.steps++;
    else {
      out.refolds++;
      out.misses.push(...f.misses);
      f = folded(held, people, now, null, null, base, true);
    }
    compare(f.state, now);
    if (r() < 0.15) {
      const later = now + Math.floor(r() * 300 * SEC);
      const again = f.next([], later);
      if (again) compare(again, later);
    }
  }
  out.misses.push(...f.misses);
  for (const k of kept) if (JSON.stringify(plain(k.state)) !== k.was && !out.differ) out.differ = `seed ${seed}: an earlier state changed`;
  if (opts.check !== false) for (const k of kept) expect(JSON.stringify(plain(k.state))).toBe(k.was);
  return out;
}

const restore: (() => void)[] = [];
afterEach(() => {
  for (const undo of restore.splice(0)) undo();
});

function patch(name: PropertyKey, fn: unknown) {
  const proto = TrackedMap.prototype as unknown as Record<PropertyKey, unknown>;
  const was = proto[name];
  proto[name] = fn;
  restore.push(() => void (proto[name] = was));
}

describe("folding each new message on the last state", () => {
  test("equals a full fold at every cut, across 40 seeds, batches of 1-5 and clock moves", () => {
    let steps = 0;
    let refolds = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const got = run(seed, 160);
      expect(got.misses).toEqual([]);
      steps += got.steps;
      refolds += got.refolds;
    }
    expect(steps).toBeGreaterThan(400);
    expect(refolds).toBeGreaterThan(100);
  }, 120_000);

  test("a lead role that waits in the roster takes effect between two appends as in a full fold", () => {
    for (let seed = 41; seed <= 50; seed++) expect(run(seed, 80, { laterRole: 30 }).misses).toEqual([]);
  }, 60_000);

  test("a trimmed base in place of the old one, then appends on it", () => {
    for (let seed = 51; seed <= 60; seed++) expect(run(seed, 140, { trimAt: 70 }).misses).toEqual([]);
  }, 60_000);

  test("with recording off, the new state is stale and differs from a full fold", () => {
    for (const name of ["get", "set", "delete", "values", "entries", "forEach"] as const) {
      const base = Map.prototype[name] as (...a: unknown[]) => unknown;
      patch(name, function (this: Map<unknown, unknown>, ...args: unknown[]) {
        return base.apply(this, args);
      });
    }
    patch(
      Symbol.iterator as never,
      function (this: Map<unknown, unknown>) {
        return Map.prototype.entries.call(this);
      } as never,
    );
    const differs = Array.from({ length: 10 }, (_, i) => run(i + 1, 160, { check: false }).differ).filter(Boolean);
    expect(differs.length).toBeGreaterThan(0);
  }, 60_000);

  test("with reads not recorded, the verifier names the keys that changed without a record", () => {
    const base = Map.prototype.get as (k: unknown) => unknown;
    patch("get", function (this: Map<unknown, unknown>, k: unknown) {
      return base.call(this, k);
    });
    const misses = Array.from({ length: 10 }, (_, i) => run(i + 1, 160, { check: false }).misses).flat();
    expect(misses.length).toBeGreaterThan(0);
  }, 60_000);
});
