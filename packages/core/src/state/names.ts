import { nameKey } from "../membership.ts";
import type { Event, Message, Payload } from "../protocol.ts";
import { leadCheckpointKey } from "./lead.ts";
import { dmPlace } from "./places.ts";
import type { Fact, FoldBase, Place, Roster, Task } from "./types.ts";

export type Aliases = ReadonlyMap<string, string>;

const NO_ALIASES: Aliases = new Map();

export function aliasesOf(roster: readonly Pick<Roster[number], "name" | "pk" | "was">[]): Aliases {
  const current = new Set(roster.map((r) => nameKey(r.name)));
  const claims = new Map<string, { old: string; to: string; pks: Set<string> }[]>();
  for (const r of roster) {
    for (const old of r.was ?? []) {
      const key = nameKey(old);
      if (current.has(key)) continue;
      const list = claims.get(key) ?? [];
      const same = list.find((c) => c.old === old && c.to === r.name);
      if (same) same.pks.add(r.pk);
      else list.push({ old, to: r.name, pks: new Set([r.pk]) });
      claims.set(key, list);
    }
  }
  const aliases = new Map<string, string>();
  for (const list of claims.values()) {
    const only = list.length === 1 ? list[0] : undefined;
    if (only && only.pks.size === 1) aliases.set(only.old, only.to);
  }
  return aliases.size ? aliases : NO_ALIASES;
}

export function currentName(aliases: Aliases, name: string): string {
  return aliases.get(name) ?? name;
}

const CHECKPOINT = leadCheckpointKey("");

function renamedKey(a: Aliases, key: string): string {
  if (!key.startsWith(CHECKPOINT)) return key;
  const to = a.get(key.slice(CHECKPOINT.length));
  return to ? leadCheckpointKey(to) : key;
}

function renamedEvent(a: Aliases, ev: Event): Event {
  const n = (x: string) => currentName(a, x);
  switch (ev.op) {
    case "task.add":
      return { ...ev, ...(ev.owner ? { owner: n(ev.owner) } : {}), ...(ev.review ? { review: n(ev.review) } : {}) };
    case "task.update":
      return { ...ev, ...(ev.owner ? { owner: n(ev.owner) } : {}), ...(ev.review ? { review: n(ev.review) } : {}) };
    case "role.set":
    case "role.refuse":
    case "seat.reclaim":
    case "color.set":
    case "picture.set":
    case "scope.set":
      return { ...ev, member: n(ev.member) };
    case "fact.set":
    case "fact.del":
      return { ...ev, key: renamedKey(a, ev.key) };
    case "hello":
    case "task.claim":
    case "card":
    case "claim":
    case "release":
    case "lease.take":
    case "lease.free":
    case "mode.set":
    case "room.create":
    case "room.rename":
    case "charter.set":
    case "compact.propose":
    case "compact":
    case "repos.set":
    case "github":
    case "github.rules":
    case "github.release":
    case "hold.set":
    case "voice.set":
    case "github.write.set":
    case "branch.prefix.set":
    case "ask.name":
    case "react":
      return ev;
    default: {
      const newer: never = ev;
      return newer;
    }
  }
}

export function renamedMessage<M extends Payload>(a: Aliases, m: M): M {
  if (!a.size) return m;
  return {
    ...m,
    from: currentName(a, m.from),
    ...(m.to ? { to: m.to.map((x) => currentName(a, x)) } : {}),
    ...(m.ev ? { ev: renamedEvent(a, m.ev) } : {}),
  };
}

export function renamedLog(a: Aliases, messages: Message[]): Message[] {
  return a.size ? messages.map((m) => renamedMessage(a, m)) : messages;
}

function renamedPlace(a: Aliases, p: Place): Place {
  return p.kind === "dm" ? dmPlace(currentName(a, p.with[0]), currentName(a, p.with[1])) : p;
}

function renamedTask(a: Aliases, t: Task): Task {
  const n = (x: string) => currentName(a, x);
  const names = (xs: readonly string[]) => [...new Set(xs.map(n))];
  const touched: Record<string, number> = {};
  for (const [who, at] of Object.entries(t.touched ?? {})) touched[n(who)] = Math.max(touched[n(who)] ?? 0, at);
  return {
    ...t,
    createdBy: n(t.createdBy),
    ...(t.owner ? { owner: n(t.owner) } : {}),
    ...(t.review ? { review: n(t.review) } : {}),
    ...(t.approvedBy ? { approvedBy: n(t.approvedBy) } : {}),
    ...(t.leftBy ? { leftBy: n(t.leftBy) } : {}),
    notes: t.notes.map((x) => ({ ...x, by: n(x.by) })),
    ...(t.proof ? { proof: t.proof.map((x) => ({ ...x, by: n(x.by) })) } : {}),
    ...(t.touched ? { touched } : {}),
    workedBy: names(t.workedBy),
    rounds: t.rounds.map((r) => ({ ...r, by: n(r.by), result: "by" in r.result ? { ...r.result, by: n(r.result.by) } : r.result })),
    ...(t.posters ? { posters: names(t.posters) } : {}),
  };
}

function renamedFacts(a: Aliases, facts: readonly Fact[]): Fact[] {
  const byKey = new Map<string, Fact>();
  for (const f of facts) {
    const next = { ...f, key: renamedKey(a, f.key), by: currentName(a, f.by) };
    const had = byKey.get(next.key);
    if (!had || had.seq < next.seq) byKey.set(next.key, next);
  }
  return [...byKey.values()];
}

export function renamedBase(a: Aliases, b: FoldBase): FoldBase {
  if (!a.size) return b;
  const n = (x: string) => currentName(a, x);
  const names = (xs: readonly string[]) => [...new Set(xs.map(n))];
  const signed = <T extends { by: string }>(x: T | null): T | null => (x ? { ...x, by: n(x.by) } : null);
  const members = new Map<string, FoldBase["members"][number]>();
  for (const m of b.members) if (!members.has(n(m.name))) members.set(n(m.name), { ...m, name: n(m.name) });
  return {
    ...b,
    members: [...members.values()],
    lead: b.lead && n(b.lead),
    charter: signed(b.charter),
    hold: signed(b.hold),
    compact: signed(b.compact),
    compactProposal: signed(b.compactProposal),
    roleSets: b.roleSets.map(([who, set]) => [n(who), set]),
    tasks: b.tasks.map((t) => renamedTask(a, t)),
    facts: renamedFacts(a, b.facts),
    leases: b.leases.map((l) => ({ ...l, ...(l.holder ? { holder: n(l.holder) } : {}), queue: l.queue.map((q) => ({ ...q, name: n(q.name) })) })),
    reactions: b.reactions.map(([seq, by]) => [seq, by.map(([who, r]) => [n(who), r])]),
    ...(b.placesBefore ? { placesBefore: b.placesBefore.map(([p, count, last]) => [renamedPlace(a, p), count, last]) } : {}),
    asks: b.asks.map((m) => renamedMessage(a, m)),
    ...(b.askHeads ? { askHeads: b.askHeads.map((h) => ({ ...h, by: n(h.by), ...(h.goalBy ? { goalBy: n(h.goalBy) } : {}) })) } : {}),
    answered: b.answered.map(([seq, by]) => [seq, names(by)]),
    threadPeople: b.threadPeople.map(([seq, people]) => [seq, names(people)]),
    rooms: b.rooms.map((r) => ({ ...r, createdBy: r.createdBy && n(r.createdBy), ...(r.posters ? { posters: names(r.posters) } : {}) })),
    placeOf: b.placeOf.map(([seq, p]) => [seq, renamedPlace(a, p)]),
  };
}
