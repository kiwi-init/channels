import { GENERAL_ROOM, ignored, isReaction, MAX_ROOMS, ROOM_ID_RE, type Message, type Trust } from "../protocol.ts";
import { refusal, scopesOf, type Scope } from "../scopes.ts";
import { applyEvent, type FoldCtx } from "./fold-events.ts";
import { allowedOnHold, isLeadRole, isPerson, LEAD, ON_HOLD } from "./people.ts";
import { dmPlace, MAIN, summarize } from "./places.ts";
import { reposOf } from "./repos.ts";
import { roomName } from "./rooms.ts";
import type { ChannelState, Fact, FoldBase, GuardFloor, Member, Place, Reaction, Room, RoomsFloor, Roster, Task } from "./types.ts";

export function fold(
  messages: Message[],
  roster: Roster,
  now = Date.now(),
  roomsFloor?: RoomsFloor | null,
  guardFloor?: GuardFloor | null,
  given?: FoldBase | null,
  keep?: (base: FoldBase) => void,
): ChannelState {
  const from = given ? structuredClone(given) : null;
  const after = from?.n ?? -1;
  const ahead = <F extends { since: number }>(f: F | null | undefined): F | null => (f && f.since >= after ? f : null);
  const members = new Map<string, Member>();
  for (const r of [...roster].sort((a, b) => Number(a.active) - Number(b.active))) {
    if (r.kind === "computer") continue;
    members.set(r.name, {
      name: r.name,
      pk: r.pk,
      role: r.role,
      about: r.about,
      kind: r.kind,
      display: r.display,
      sponsor: r.sponsor,
      color: r.color,
      scopes: scopesOf(r),
      ...(r.runs ? { runs: r.runs } : {}),
      owner: r.owner,
      joined: r.at,
      lastSeen: r.at,
      messages: 0,
      active: r.active,
    });
  }
  const worn = new Set<string>();
  for (const m of [...members.values()].filter((x) => x.active && isPerson(x)).sort((a, b) => a.joined - b.joined)) {
    if (m.color && worn.has(m.color)) m.color = undefined;
    else if (m.color) worn.add(m.color);
  }
  let lead: string | null = null;
  for (const m of [...members.values()].filter((x) => x.active && isLeadRole(x.role)).sort((a, b) => a.joined - b.joined)) {
    if (lead) m.role = undefined;
    else {
      m.role = LEAD;
      lead = m.name;
    }
  }
  if (from) {
    const prior = new Map(from.members.map((p) => [p.name, p]));
    lead = from.lead;
    for (const m of [...members.values()].sort((a, b) => a.joined - b.joined)) {
      const p = prior.get(m.name);
      if (!p) {
        if (m.active && isLeadRole(m.role)) {
          if (lead && lead !== m.name) m.role = undefined;
          else {
            m.role = LEAD;
            lead = m.name;
          }
        }
        continue;
      }
      m.role = p.role;
      m.about = p.about;
      m.color = p.color;
      if (p.card) m.card = p.card;
      m.lastSeen = Math.max(m.lastSeen, p.lastSeen);
      m.messages = p.messages;
    }
  }
  const ownerName = [...members.values()].find((x) => x.owner)?.name ?? "owner";
  let charterFloor = ahead(guardFloor?.charter);
  let holdFloor = ahead(guardFloor?.hold);
  let reposFloor = ahead(guardFloor?.repos);
  const passGuard = (seq: number) => {
    if (charterFloor && charterFloor.since < seq) {
      ctx.charter = charterFloor.text ? { text: charterFloor.text, by: ownerName, at: ctx.charter?.at ?? 0 } : null;
      charterFloor = null;
    }
    if (holdFloor && holdFloor.since < seq) {
      ctx.hold = holdFloor.on ? { ...(holdFloor.note ? { note: holdFloor.note } : {}), by: ownerName, at: ctx.hold?.at ?? 0 } : null;
      holdFloor = null;
    }
    if (reposFloor && reposFloor.since < seq) {
      ctx.repos = reposOf(reposFloor.list);
      reposFloor = null;
    }
  };
  const humanFor = (a: Member) => (a.sponsor ? [...members.values()].find((x) => x.active && isPerson(x) && x.sponsor?.user === a.sponsor!.user)?.name : undefined);
  const keysByName = new Map<string, Set<string>>();
  for (const r of roster) {
    let set = keysByName.get(r.name);
    if (!set) keysByName.set(r.name, (set = new Set()));
    set.add(r.pk);
  }
  const scopesByKey = new Map<string, Scope[]>();
  for (const r of roster) scopesByKey.set(r.pk, scopesOf(r));
  for (const [pk, scopes] of from?.scopesByKey ?? []) scopesByKey.set(pk, scopes);
  const floors = roster
    .filter((r) => r.later && !r.owner && !!ahead(r.later))
    .map((r) => ({ pk: r.pk, ...r.later! }))
    .sort((a, b) => a.since - b.since);
  const passFloors = (seq: number) => {
    while (floors.length && floors[0]!.since < seq) {
      const f = floors.shift()!;
      scopesByKey.set(f.pk, f.scopes);
    }
  };
  const scopeSets = new Map<string, { seq: number; scopes: Scope[] }>(from?.scopeSets);
  const roleSets = new Map<string, { seq: number; role: string | null; about?: string | null }>(from?.roleSets);
  const setRole = (target: Member, role: string | null, about: string | null | undefined) => {
    const leads = isLeadRole(role ?? undefined);
    if (leads) {
      const was = lead && members.get(lead);
      if (was && was !== target) was.role = undefined;
      lead = target.name;
    } else if (lead === target.name) lead = null;
    target.role = leads ? LEAD : role || undefined;
    if (about !== undefined) target.about = about || undefined;
  };
  const roleFloors = roster
    .filter((r) => r.laterRole && !r.owner && r.active && !!ahead(r.laterRole))
    .map((r) => ({ name: r.name, pk: r.pk, ...r.laterRole! }))
    .sort((a, b) => a.since - b.since);
  const passRoleFloors = (seq: number) => {
    while (roleFloors.length && roleFloors[0]!.since < seq) {
      const f = roleFloors.shift()!;
      const target = members.get(f.name);
      if (target?.pk === f.pk) setRole(target, f.role, f.about);
    }
  };
  const tasks = new Map<number, Task>(from?.tasks.map((t) => [t.id, t]));
  const facts = new Map<string, Fact>(from?.facts.map((f) => [f.key, f]));
  const reactions = new Map<number, Map<string, Reaction>>(from?.reactions.map(([seq, by]) => [seq, new Map(by)]));
  const reactSeqs = new Set<number>(from?.reactSeqs);
  const trust = new Map<number, Trust>(from?.trust);
  const rejected = new Map<number, string>(from?.rejected);
  const answered = new Map<number, Set<string>>(from?.answered.map(([seq, by]) => [seq, new Set(by)]));
  const threadOf = new Map<number, number>(from?.threadOf);
  const threadPeople = new Map<number, Set<string>>(from?.threadPeople.map(([seq, people]) => [seq, new Set(people)]));
  let head = from?.n ?? 0;

  const known = new Map<string, Room>(from?.rooms.map((r) => [r.id, r]));
  const rooms = new Map<string, Room>([[GENERAL_ROOM, known.get(GENERAL_ROOM) ?? { id: GENERAL_ROOM, name: GENERAL_ROOM, createdBy: null, at: 0 }]]);
  const roomsSince = roomsFloor?.since ?? -1;
  for (const r of ahead(roomsFloor)?.list ?? []) {
    const name = roomName(r.name);
    if (!ROOM_ID_RE.test(r.id) || !name || (rooms.size >= MAX_ROOMS && !rooms.has(r.id))) continue;
    rooms.set(r.id, { ...(rooms.get(r.id) ?? known.get(r.id) ?? { id: r.id, createdBy: null, at: 0 }), name });
  }
  for (const [id, r] of known) if (!rooms.has(id)) rooms.set(id, r);
  const nameTaken = (name: string, except?: string) => [...rooms.values()].some((r) => r.id !== except && r.name.toLowerCase() === name.toLowerCase());
  const roomOf = new Map<number, string>(from?.roomOf);
  const placeOf = new Map<number, Place>(from?.placeOf);
  const ctx: FoldCtx = {
    members,
    keysByName,
    scopesByKey,
    scopeSets,
    roleSets,
    setRole,
    tasks,
    facts,
    rooms,
    roomsSince,
    nameTaken,
    charter: from?.charter ?? null,
    repos: reposOf(from?.repos ?? []),
    hold: from?.hold ?? null,
  };

  for (const m of messages) {
    if (m.seq <= after) continue;
    passFloors(m.seq);
    passRoleFloors(m.seq);
    passGuard(m.seq);
    try {
      head = Math.max(head, m.seq);
      const at = m.rts ?? m.ts;

      const member = members.get(m.from);
      const t: Trust = m.sigOk && !!m.pk && !!keysByName.get(m.from)?.has(m.pk) ? "verified" : "forged";
      trust.set(m.seq, t);
      if (t === "forged" || !member) {
        rejected.set(m.seq, member ? `not signed by ${m.from}'s key` : `${m.from} isn't a member`);
        continue;
      }
      const refused = refusal(scopesByKey.get(m.pk!) ?? [], m);
      if (refused) {
        trust.set(m.seq, "refused");
        rejected.set(m.seq, `${m.from} ${refused}`);
        continue;
      }
      if (m.esc) {
        const may = new Set([humanFor(member), [...members.values()].find((x) => x.owner)?.name].filter(Boolean));
        if (isPerson(member) || m.kind === "event" || !m.to?.length || !m.to.every((n) => may.has(n))) {
          trust.set(m.seq, "refused");
          rejected.set(m.seq, "an escalation goes from an agent to its own human and the owner, no one else");
          continue;
        }
      }
      if (
        ctx.hold &&
        !isPerson(member) &&
        !allowedOnHold(m, (n) => {
          const p = members.get(n);
          return !!p && isPerson(p);
        })
      ) {
        trust.set(m.seq, "refused");
        rejected.set(m.seq, ON_HOLD);
        continue;
      }
      if (m.kind !== "event") {
        const parent = m.re?.[0];
        const room = (parent !== undefined ? roomOf.get(parent) : undefined) ?? m.room ?? GENERAL_ROOM;
        if (!rooms.has(room)) {
          trust.set(m.seq, "refused");
          rejected.set(m.seq, `no room ${room}`);
          continue;
        }
        roomOf.set(m.seq, room);
        const parentPlace = parent !== undefined ? placeOf.get(parent) : undefined;
        const to = m.to?.length === 1 ? m.to[0]! : undefined;
        placeOf.set(m.seq, parentPlace ?? (m.task !== undefined && tasks.has(m.task) ? { kind: "task", task: m.task } : m.dm && to && to !== m.from && members.has(to) ? dmPlace(m.from, to) : MAIN));
      }
      member.lastSeen = Math.max(member.lastSeen, at);
      if (!isReaction(m)) member.messages++;

      for (const r of m.re ?? []) {
        let set = answered.get(r);
        if (!set) answered.set(r, (set = new Set()));
        set.add(m.from);
      }

      if (m.kind !== "event") {
        const parent = m.re?.[0];
        const root = parent === undefined ? m.seq : (threadOf.get(parent) ?? parent);
        threadOf.set(m.seq, root);
        let people = threadPeople.get(root);
        if (!people) threadPeople.set(root, (people = new Set()));
        people.add(m.from);
        for (const t of m.to ?? []) if (!t.startsWith("role:")) people.add(t);
      }

      const ev = m.ev;
      if (m.kind !== "event" || !ev) continue;
      const reject = (why: string) => rejected.set(m.seq, why);
      if (ev.op === "react") {
        reactSeqs.add(m.seq);
        const target = ev.seq < m.seq ? trust.get(ev.seq) : undefined;
        if (!target || ignored(target) || reactSeqs.has(ev.seq) || !placeOf.has(ev.seq)) {
          reject(`no message #${ev.seq} to react to`);
          continue;
        }
        let on = reactions.get(ev.seq);
        if (ev.emoji === null) on?.delete(m.from);
        else {
          if (!on) reactions.set(ev.seq, (on = new Map()));
          on.set(m.from, { emoji: ev.emoji, seq: m.seq, at });
        }
        if (on && !on.size) reactions.delete(ev.seq);
        continue;
      }
      placeOf.set(m.seq, ev.op === "task.add" ? { kind: "task", task: m.seq } : (ev.op === "task.update" || ev.op === "task.claim") && tasks.has(ev.task) ? { kind: "task", task: ev.task } : MAIN);

      applyEvent(ctx, m, ev, member, at, reject);
    } catch {
      trust.set(m.seq, "forged");
      rejected.set(m.seq, "malformed message");
    }
  }

  const openAsks = [...(from?.asks ?? []), ...messages.filter((m) => m.seq > after)].filter((m) => {
    if (m.kind !== "ask" && m.kind !== "blocking") return false;
    if (ignored(trust.get(m.seq))) return false;
    const by = answered.get(m.seq);
    return !by || [...by].every((n) => n === m.from);
  });

  keep?.(
    structuredClone({
      n: head,
      members: [...members.values()].map((m) => ({ name: m.name, role: m.role, about: m.about, color: m.color, card: m.card, lastSeen: m.lastSeen, messages: m.messages })),
      lead,
      charter: ctx.charter,
      repos: ctx.repos,
      hold: ctx.hold,
      scopesByKey: [...scopesByKey],
      scopeSets: [...scopeSets],
      roleSets: [...roleSets],
      tasks: [...tasks.values()],
      facts: [...facts.values()],
      reactions: [...reactions].map(([seq, by]): [number, [string, Reaction][]] => [seq, [...by]]),
      reactSeqs: [...reactSeqs],
      trust: [...trust],
      rejected: [...rejected],
      asks: openAsks,
      answered: openAsks.flatMap((m): [number, string[]][] => [[m.seq, [...(answered.get(m.seq) ?? [])]]]),
      threadOf: [...threadOf],
      threadPeople: [...threadPeople].map(([seq, people]): [number, string[]] => [seq, [...people]]),
      rooms: [...rooms.values()],
      roomOf: [...roomOf],
      placeOf: [...placeOf],
    }),
  );

  passFloors(Infinity);
  passRoleFloors(Infinity);
  for (const member of members.values()) member.scopes = scopesByKey.get(member.pk) ?? [];
  for (const [key, fact] of facts) if (fact.expires !== undefined && fact.expires <= now) facts.delete(key);

  passGuard(Infinity);

  return {
    members,
    tasks,
    facts,
    trust,
    scopeSets,
    roleSets,
    rejected,
    openAsks,
    threadOf,
    threadPeople,
    lead: lead && members.get(lead)?.active ? lead : null,
    rooms,
    roomOf,
    placeOf,
    places: summarize(placeOf, tasks, trust),
    charter: ctx.charter,
    repos: ctx.repos,
    hold: ctx.hold,
    reactions,
    head,
  };
}
