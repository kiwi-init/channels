import { PROTOCOL_VERSION, type Event, type Message } from "@kiwi/core/protocol.ts";
import type { Roster } from "@kiwi/core/state.ts";

export const T0 = 1_700_000_000_000;
export const SEC = 1_000;
const OWNER = "o".repeat(43);
const PAT = "p".repeat(43);
const WIN = "w".repeat(43);
const ANN = "a".repeat(43);
const PKS: Record<string, string> = { jow: OWNER, pat: PAT, win: WIN, ann: ANN };
const PEOPLE = ["jow", "pat"];
const AGENTS = ["win", "ann"];
const EVERYONE = [...PEOPLE, ...AGENTS];

export const roster = (laterRole?: number): Roster => [
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

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Stream {
  messages: Message[];
  times: number[];
}

export function stream(seed: number, length: number, opts: { duty?: boolean } = {}): Stream {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const messages: Message[] = [];
  const chats: Message[] = [];
  const asks: Message[] = [];
  const perms: Message[] = [];
  const tasks: number[] = [];
  let duty = 0;
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
    else if (opts.duty && roll < 0.885) m = event(seq, "jow", { op: "lead.standby", name: "win", on: r() < 0.7 });
    else if (opts.duty && roll < 0.89) {
      m = event(seq, pick(["jow", "win"]), { op: "lead.duty", to: pick(["win", "ann"]), from: r() < 0.7 ? duty : 0 });
      duty = seq;
    } else m = base(seq, from, { body: `chat ${seq} for @${pick(EVERYONE)}` });
    if (m.kind !== "event") chats.push(m);
    messages.push(m);
  }
  return { messages, times };
}
