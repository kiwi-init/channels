import { GENERAL_ROOM, ignored, isReaction, MAX_ROOMS, ROOM_ID_RE, type Message, type Trust } from "../protocol.ts";
import { refusal, scopesOf, type Scope } from "../scopes.ts";
import { applyEvent, type FoldCtx } from "./fold-events.ts";
import { allowedOnHold, isLeadRole, isPerson, LEAD, ON_HOLD } from "./people.ts";
import { dmPlace, MAIN, placeKey, summarize } from "./places.ts";
import { prKey } from "./github.ts";
import { reposOf } from "./repos.ts";
import { roomName } from "./rooms.ts";
import { settle } from "./leases.ts";
import { carriedPersona } from "../personality.ts";
import type { ChannelState, Fact, FoldBase, FoldMember, GuardFloor, Lease, Member, Place, Reaction, Room, RoomsFloor, Roster, Task } from "./types.ts";

const STALE_MS = 24 * 3_600_000;
const SENT_WINDOW_MS = 2 * STALE_MS;
const KEEP_SEQS = 5_000;
const SENT_CAP = 3_000;
const CLOSED_KEEP_MS = 30 * STALE_MS;

const closedLongAgo = (at: number, hw: number) => hw - at > CLOSED_KEEP_MS;

type Sent = [number, string];

const earlier = (a: Sent, b: Sent) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

function heapPush(heap: Sent[], item: Sent): void {
  heap.push(item);
  for (let i = heap.length - 1; i > 0;) {
    const up = (i - 1) >> 1;
    if (!earlier(heap[i]!, heap[up]!)) break;
    [heap[i], heap[up]] = [heap[up]!, heap[i]!];
    i = up;
  }
}

function heapPop(heap: Sent[]): Sent {
  const top = heap[0]!;
  const last = heap.pop()!;
  if (heap.length) {
    heap[0] = last;
    for (let i = 0; ;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let min = i;
      if (l < heap.length && earlier(heap[l]!, heap[min]!)) min = l;
      if (r < heap.length && earlier(heap[r]!, heap[min]!)) min = r;
      if (min === i) break;
      [heap[i], heap[min]] = [heap[min]!, heap[i]!];
      i = min;
    }
  }
  return top;
}

function card(t: Task): Task {
  return {
    id: t.id,
    title: t.title,
    state: t.state,
    ...(t.owner !== undefined ? { owner: t.owner } : {}),
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    notes: [],
    rounds: [],
    ...(t.approvedBy !== undefined ? { approvedBy: t.approvedBy } : {}),
    ...(t.review !== undefined ? { review: t.review } : {}),
    workedBy: t.workedBy,
    ...(t.cancelled ? { cancelled: true } : {}),
    ...(t.closedSeq !== undefined ? { closedSeq: t.closedSeq } : {}),
    ...(t.issue ? { issue: t.issue } : {}),
    ...(t.archived ? { archived: true } : {}),
  };
}

function withoutImageBytes(m: Message): Message {
  return m.imgs?.length ? { ...m, imgs: m.imgs.map((i) => ({ name: i.name, mime: i.mime, ...(i.ref ? { ref: i.ref } : {}) })) } : m;
}

function touch(task: Task | undefined, name: string, at: number): void {
  if (task && (task.touched?.[name] ?? 0) < at) task.touched = { ...task.touched, [name]: at };
}

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
  const members = new Map<string, FoldMember>();
  const signed = new Set(roster.filter((r) => r.persona && r.kind !== "computer").map((r) => r.name));
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
      ...(r.persona ? { persona: r.persona } : {}),
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
      if (p.picture) m.picture = p.picture;
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
  const setRole = (target: FoldMember, role: string | null, about: string | null | undefined) => {
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
  const leases = new Map<string, Lease>(from?.leases.map((l) => [l.name, l]));
  const reactions = new Map<number, Map<string, Reaction>>(from?.reactions.map(([seq, by]) => [seq, new Map(by)]));
  const reactSeqs = new Set<number>(from?.reactSeqs);
  const trust = new Map<number, Trust>(from?.trust);
  const rejected = new Map<number, string>(from?.rejected);
  const sent = new Map<string, number>();
  const sentAt = new Map<string, number>();
  const sentKey = new Map<string, string>();
  const heap: Sent[] = [];
  const untimed: string[] = [];
  const sentFloors = new Map<string, number>(from?.sentFloors);
  const sentKeys = from?.sentKeys ?? [];
  for (const [id, seq, ts, k] of from?.sent ?? []) {
    sent.set(id, seq);
    if (ts === undefined) {
      untimed.push(id);
      continue;
    }
    sentAt.set(id, ts);
    const pk = k !== undefined && k >= 0 ? sentKeys[k] : undefined;
    if (pk === undefined) continue;
    sentKey.set(id, pk);
    heapPush(heap, [ts, id]);
  }
  const forget = (id: string) => {
    sent.delete(id);
    sentAt.delete(id);
    sentKey.delete(id);
  };
  let hw = from?.hw ?? 0;
  const placesBefore = new Map<string, [Place, number, number]>(from?.placesBefore?.map((p) => [placeKey(p[0]), p]));
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
    leases,
    rooms,
    roomsSince,
    nameTaken,
    charter: from?.charter ?? null,
    compact: from?.compact ?? null,
    compactProposal: from?.compactProposal ?? null,
    repos: reposOf(from?.repos ?? []),
    github: {
      prs: new Map(from?.github?.prs.map((p) => [prKey(p.repo, p.number), p])),
      checks: new Map(from?.github?.checks.map(([k, runs]) => [k, new Map(runs.map((r) => [r.name, r]))])),
      issues: new Map(from?.github?.issues?.map((i) => [prKey(i.repo, i.number), i])),
    },
    hold: from?.hold ?? null,
    voice: from?.voice ?? false,
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
      const first = sent.get(m.id);
      if (first !== undefined && first !== m.seq) {
        trust.set(m.seq, "refused");
        rejected.set(m.seq, `a copy of #${first}, sent again`);
        continue;
      }
      if (m.rts !== undefined && m.rts - m.ts > STALE_MS) {
        trust.set(m.seq, "refused");
        rejected.set(m.seq, `signed more than a day before the relay got it`);
        continue;
      }
      if (m.ts < Math.max(hw - SENT_WINDOW_MS, sentFloors.get(m.pk!) ?? 0)) {
        trust.set(m.seq, "refused");
        rejected.set(m.seq, `signed too long before the channel's latest messages`);
        continue;
      }
      sent.set(m.id, m.seq);
      sentAt.set(m.id, m.ts);
      sentKey.set(m.id, m.pk!);
      heapPush(heap, [m.ts, m.id]);
      hw = Math.max(hw, Math.min(m.ts, m.rts ?? m.ts));
      while (heap.length && heap[0]![0] < hw - SENT_WINDOW_MS) forget(heapPop(heap)[1]);
      while (heap.length > SENT_CAP) {
        const [ts, id] = heapPop(heap);
        const pk = sentKey.get(id);
        forget(id);
        if (pk !== undefined) sentFloors.set(pk, Math.max(sentFloors.get(pk) ?? 0, ts + 1));
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
        const place =
          parentPlace ?? (m.task !== undefined && tasks.has(m.task) ? { kind: "task" as const, task: m.task } : m.dm && to && to !== m.from && members.has(to) ? dmPlace(m.from, to) : MAIN);
        placeOf.set(m.seq, place);
        const posted = place.kind === "task" ? tasks.get(place.task) : place.kind === "main" && room !== GENERAL_ROOM ? rooms.get(room) : undefined;
        if (posted && !posted.posters?.includes(m.from)) posted.posters = [...(posted.posters ?? []), m.from];
        if (place.kind === "task") touch(tasks.get(place.task), m.from, at);
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
      const evPlace = placeOf.get(m.seq);
      const evTask = evPlace?.kind === "task" && !rejected.has(m.seq) ? tasks.get(evPlace.task) : undefined;
      if (evTask && (evTask.owner === m.from || evTask.workedBy.includes(m.from))) touch(evTask, m.from, at);
    } catch {
      trust.set(m.seq, "forged");
      rejected.set(m.seq, "malformed message");
    }
  }

  const openAsks = [...(from?.asks ?? []), ...messages.filter((m) => m.seq > after)].filter((m) => {
    if (m.kind !== "ask" && m.kind !== "blocking") return false;
    if (ignored(trust.get(m.seq))) return false;
    const by = answered.get(m.seq);
    const answers = (n: string) => (m.esc ? !!m.to?.includes(n) : n !== m.from);
    return !by || ![...by].some(answers);
  });

  const cut = head - KEEP_SEQS;
  for (const id of untimed) if (sent.has(id) && !sentAt.has(id)) sentAt.set(id, hw);
  const keyIndex = new Map<string, number>();
  const keptSent = [...sent].flatMap(([id, seq]): [string, number, number, number][] => {
    const ts = sentAt.get(id);
    if (ts === undefined || ts < hw - SENT_WINDOW_MS) return [];
    const pk = sentKey.get(id);
    if (pk === undefined) return [[id, seq, ts, -1]];
    if (!keyIndex.has(pk)) keyIndex.set(pk, keyIndex.size);
    return [[id, seq, ts, keyIndex.get(pk)!]];
  });
  const wholeTasks = [...tasks.values()].filter((t) => !((t.state === "done" || t.cancelled) && closedLongAgo(t.updatedAt, hw)));
  const taskIssues = new Set(wholeTasks.flatMap((t) => (t.issue ? [prKey(t.issue.repo, t.issue.number)] : [])));
  const before = new Map(placesBefore);
  for (const [seq, place] of placeOf) {
    if (seq > cut || ignored(trust.get(seq))) continue;
    const key = placeKey(place);
    const held = before.get(key);
    before.set(key, held ? [place, held[1] + 1, Math.max(held[2], seq)] : [place, 1, seq]);
  }
  const keptThreads = [...threadOf].filter(([seq]) => seq > cut);
  const keptRoots = new Set(keptThreads.map(([, root]) => root));
  keep?.(
    structuredClone({
      n: head,
      members: [...members.values()].map((m) => ({ name: m.name, role: m.role, about: m.about, color: m.color, picture: m.picture, card: m.card, lastSeen: m.lastSeen, messages: m.messages })),
      lead,
      charter: ctx.charter,
      compact: ctx.compact,
      compactProposal: ctx.compactProposal,
      repos: ctx.repos,
      github: {
        prs: [...ctx.github.prs.values()].filter((p) => p.state === "open" || !closedLongAgo(p.at, hw)),
        checks: [...ctx.github.checks].map(([k, runs]) => [k, [...runs.values()]]),
        issues: [...ctx.github.issues.values()].filter((i) => i.state === "open" || !closedLongAgo(i.at, hw) || taskIssues.has(prKey(i.repo, i.number))),
      },
      hold: ctx.hold,
      voice: ctx.voice,
      scopesByKey: [...scopesByKey],
      scopeSets: [...scopeSets],
      roleSets: [...roleSets],
      tasks: [...tasks.values()].map((t) => ((t.state === "done" || t.cancelled) && closedLongAgo(t.updatedAt, hw) ? card(t) : t)),
      facts: [...facts.values()],
      leases: [...leases.values()],
      reactions: [...reactions].filter(([seq]) => seq > cut).map(([seq, by]): [number, [string, Reaction][]] => [seq, [...by]]),
      reactSeqs: [...reactSeqs].filter((seq) => seq > cut),
      trust: [...trust].filter(([seq]) => seq > cut),
      rejected: [...rejected].filter(([seq]) => seq > cut),
      sent: keptSent,
      sentKeys: [...keyIndex.keys()],
      sentFloors: [...sentFloors].filter(([, floor]) => floor > hw - SENT_WINDOW_MS),
      hw,
      placesBefore: [...before.values()],
      asks: openAsks.map(withoutImageBytes),
      answered: openAsks.flatMap((m): [number, string[]][] => [[m.seq, [...(answered.get(m.seq) ?? [])]]]),
      threadOf: keptThreads,
      threadPeople: [...threadPeople].filter(([root]) => root > cut || keptRoots.has(root)).map(([seq, people]): [number, string[]] => [seq, [...people]]),
      rooms: [...rooms.values()],
      roomOf: [...roomOf].filter(([seq]) => seq > cut),
      placeOf: [...placeOf].filter(([seq]) => seq > cut),
    }),
  );

  passFloors(Infinity);
  passRoleFloors(Infinity);
  for (const member of members.values()) member.scopes = scopesByKey.get(member.pk) ?? [];
  const signedLead = [...members.values()].filter((m) => m.active && signed.has(m.name) && m.persona?.role === "lead").sort((a, b) => a.joined - b.joined)[0]?.name;
  const legacyLead = lead && members.get(lead)?.active && !signed.has(lead) ? lead : null;
  const theLead = signedLead ?? legacyLead;
  for (const m of members.values()) {
    if (!signed.has(m.name)) {
      const leads = m.name === theLead;
      const wasLead = isLeadRole(m.role);
      const persona = (isPerson(m) || wasLead) && !leads ? undefined : carriedPersona(leads, wasLead ? undefined : m.role, m.about, m.scopes);
      if (persona) m.persona = persona;
      else delete m.persona;
    }
    delete m.role;
    delete m.about;
  }
  for (const [key, fact] of facts) if (fact.expires !== undefined && fact.expires <= now) facts.delete(key);
  for (const [name, lease] of leases) {
    settle(lease, now);
    if (!lease.holder && !lease.queue.length) leases.delete(name);
  }

  passGuard(Infinity);

  return {
    members,
    tasks,
    facts,
    leases,
    trust,
    scopeSets,
    roleSets,
    rejected,
    openAsks,
    threadOf,
    threadPeople,
    lead: theLead ?? null,
    rooms,
    roomOf,
    placeOf,
    places: summarize(placeOf, tasks, trust, placesBefore.values()),
    charter: ctx.charter,
    compact: ctx.compact,
    compactProposal: ctx.compactProposal,
    repos: ctx.repos,
    github: ctx.github,
    hold: ctx.hold,
    voice: ctx.voice,
    reactions,
    head,
  };
}
