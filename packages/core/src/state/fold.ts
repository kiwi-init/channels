import {
  editable,
  EVENT_OPS_VERSION,
  FOLD_RULES,
  GENERAL_ROOM,
  ignored,
  isOverlay,
  MAX_GOAL_NAME,
  MAX_ROOMS,
  POWERS,
  powerChange,
  ROOM_ID_RE,
  type Message,
  type Power,
  type Trust,
} from "../protocol.ts";
import { inlineText } from "../membership.ts";
import { canPost, refusal, scopesOf, type Scope } from "../scopes.ts";
import { applyEvent, type FoldCtx } from "./fold-events.ts";
import { allowedOnHold, answersAsk, isLeadRole, isPerson, LEAD, ON_HOLD, sameAuthor } from "./people.ts";
import { omit } from "../omit.ts";
import { dmPlace, MAIN, summarize } from "./places.ts";
import { rootOf } from "../room-rules.ts";
import { askHeadOf, fileTask } from "./asks.ts";
import { taskId } from "./tasks.ts";
import { linkSafe, prKey, releasesFrom, repoKey } from "./github.ts";
import { reposOf } from "./repos.ts";
import { roomName } from "./rooms.ts";
import { settle } from "./leases.ts";
import { carriedPersona } from "../personality.ts";
import { permissionAnswer } from "../permission.ts";
import type { AskHead, ChannelState, Edit, Fact, FoldBase, FoldMember, GuardFloor, Lease, Member, PersonaLead, Place, Reaction, Room, RoomsFloor, Roster, SecretRoom, Task } from "./types.ts";
import { inRoom } from "../room-rules.ts";

const STALE_MS = 24 * 3_600_000;
const SENT_WINDOW_MS = 2 * STALE_MS;
const KEEP_SEQS = 5_000;
const SENT_CAP = 3_000;
const CLOSED_KEEP_MS = 30 * STALE_MS;

const closedLongAgo = (at: number, hw: number) => hw - at > CLOSED_KEEP_MS;

function idHash(id: string): number {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return 4294967296 * (2097151 & b) + (a >>> 0);
}

const card = (t: Task): Task => ({ ...omit(t, "detail", "proof", "from", "areas", "touched", "source", "posters"), notes: [], rounds: t.rounds.slice(-1) });

function earlierParent(m: Message): number | undefined {
  const parent = m.re?.[0];
  return parent !== undefined && parent < m.seq ? parent : undefined;
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
  return folding(messages, roster, now, roomsFloor, guardFloor, given, keep, true);
}

function folding(
  messages: Message[],
  roster: Roster,
  now: number,
  roomsFloor: RoomsFloor | null | undefined,
  guardFloor: GuardFloor | null | undefined,
  given: FoldBase | null | undefined,
  keep: ((base: FoldBase) => void) | undefined,
  lookAhead: boolean,
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
      ...(r.addsAgents && r.kind === "human" && !r.owner ? { addsAgents: true } : {}),
      ...(r.answersDecisions && r.kind === "human" && !r.owner ? { answersDecisions: true } : {}),
      ...(r.managesAgents && r.kind === "human" && !r.owner ? { managesAgents: true } : {}),
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
      if (p.ops) m.ops = { ...p.ops };
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
  const personaLead = new Map<string, PersonaLead>(from?.personaLeads);
  const leadChanges = lookAhead
    ? messages.flatMap((m) =>
        m.seq > after && m.ev?.op === "scope.set" && m.ev.wasLead !== undefined && !personaLead.has(m.ev.member) ? [{ seq: m.seq, member: m.ev.member, was: m.ev.wasLead }] : [],
      )
    : [];
  const powers = new Map<string, Partial<Record<Power, boolean>>>(from?.powers?.map(([name, p]) => [name, { ...p }]));
  const powerChanges = lookAhead
    ? messages.flatMap((m) => {
        if (m.seq <= after || m.ev?.op !== "power.set") return [];
        const { power } = powerChange(m.ev);
        return powers.get(m.ev.pk)?.[power] === undefined ? [{ seq: m.seq, pk: m.ev.pk, power, was: m.ev.was }] : [];
      })
    : [];
  if (leadChanges.length || powerChanges.length) {
    const accepted = folding(messages, roster, now, roomsFloor, guardFloor, given, undefined, false);
    const took = (seq: number) => accepted.trust.get(seq) === "verified" && !accepted.rejected.has(seq);
    for (const c of leadChanges) if (!personaLead.has(c.member) && took(c.seq)) personaLead.set(c.member, c.was);
    for (const c of powerChanges) if (powers.get(c.pk)?.[c.power] === undefined && took(c.seq)) powers.set(c.pk, { ...powers.get(c.pk), [c.power]: c.was });
  }
  const recordOf = new Map(roster.map((r) => [r.pk, r]));
  const held = (pk: string, power: Power): boolean => powers.get(pk)?.[power] ?? !!recordOf.get(pk)?.[power];
  const trusted = (pk: string, member: FoldMember): boolean => member.kind === "human" && !member.owner && canPost(scopesByKey.get(pk) ?? []) && POWERS.every((p) => held(pk, p));
  const logged = (member: FoldMember): boolean | undefined => {
    const lead = personaLead.get(member.name);
    return lead === "roster" ? undefined : lead;
  };
  const leads = (member: FoldMember): boolean => member.owner || isLeadRole(member.role) || (logged(member) ?? (signed.has(member.name) && member.persona?.role === "lead"));
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
  const chatBy = new Map<number, string>(from?.chatBy);
  const edits = new Map<number, Edit>(from?.edits);
  const deleted = new Map<number, number>(from?.deleted);
  let skipped = from?.skipped === true;
  const trust = new Map<number, Trust>(from?.trust);
  const rejected = new Map<number, string>(from?.rejected);
  const sent = new Map<string, number>();
  const sentAt = new Map<string, number>();
  const queue = new Map<string, string>();
  const sentFloors = new Map<string, number>(from?.sentFloors);
  const old = new Map<number, number>(from?.oldSent?.map(([seq, hash]) => [hash, seq]));
  for (const [id, seq, ts, k] of from?.sent ?? []) {
    const pk = from?.sentKeys?.[k ?? -1];
    if (pk === undefined || ts === undefined) {
      old.set(idHash(id), seq);
      continue;
    }
    sent.set(id, seq);
    sentAt.set(id, ts);
    queue.set(id, pk);
  }
  let hw = from?.hw ?? 0;
  const placesBefore = from?.placesBefore ?? [];
  const answered = new Map<number, Set<string>>(from?.answered.map(([seq, by]) => [seq, new Set(by)]));
  const closedAsks = new Set<number>();
  const askers = new Map([...(from?.asks ?? []), ...messages].flatMap((a): [number, string][] => ((a.kind === "ask" || a.kind === "blocking") && !a.permission ? [[a.seq, a.from]] : [])));
  const settledBy = new Map<number, Set<string>>();
  const permReplies = new Map<number, Message[]>();
  const permBySeq = new Map<number, Message>();
  const threadOf = new Map<number, number>(from?.threadOf);
  const threadPeople = new Map<number, Set<string>>(from?.threadPeople.map(([seq, people]) => [seq, new Set(people)]));
  const askHeads = new Map<number, AskHead>(from?.askHeads?.map((h) => [h.id, h]));
  let head = from?.n ?? 0;

  const known = new Map<string, Room>(from?.rooms.map((r) => [r.id, r]));
  const rooms = new Map<string, Room>([[GENERAL_ROOM, known.get(GENERAL_ROOM) ?? { id: GENERAL_ROOM, name: GENERAL_ROOM, createdBy: null, at: 0 }]]);
  const roomsSince = roomsFloor?.since ?? -1;
  const secret = new Map<string, SecretRoom>(from?.secret?.map(([id, r]): [string, SecretRoom] => [id, { ...r }]));
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
    signed,
    personaLead,
    powers,
    held,
    trusted,
    leads,
    keysByName,
    scopesByKey,
    scopeSets,
    roleSets,
    setRole,
    tasks,
    facts,
    leases,
    rooms,
    secret,
    roomsSince,
    nameTaken,
    charter: from?.charter ?? null,
    compact: from?.compact ?? null,
    compactProposal: from?.compactProposal ?? null,
    repos: reposOf(from?.repos ?? []),
    github: {
      prs: new Map(from?.github?.prs.map((p) => [prKey(p.repo, p.number), linkSafe(p)])),
      checks: new Map(from?.github?.checks.map(([k, runs]) => [k, new Map(runs.map((r) => [r.name, linkSafe(r)]))])),
      issues: new Map(from?.github?.issues?.map((i) => [prKey(i.repo, i.number), linkSafe(i)])),
      rules: new Map(from?.github?.rules?.map((r) => [repoKey(r.repo), r])),
      releases: releasesFrom(from?.github?.releases),
    },
    hold: from?.hold ?? null,
    githubWrite: from?.githubWrite ?? null,
    branchPrefix: from?.branchPrefix ?? null,
  };

  const seen = new Set<number>();
  const doubled = new Set<number>();
  for (const m of messages) if (m.seq > after) (seen.has(m.seq) ? doubled : seen).add(m.seq);

  for (const m of messages) {
    if (m.seq <= after) continue;
    passFloors(m.seq);
    passRoleFloors(m.seq);
    passGuard(m.seq);
    try {
      head = Math.max(head, m.seq);
      const at = m.rts ?? m.ts;
      if (doubled.has(m.seq)) {
        trust.set(m.seq, "refused");
        rejected.set(m.seq, `two messages at #${m.seq}`);
        continue;
      }

      const member = members.get(m.from);
      const t: Trust = m.sigOk && !!m.pk && !!keysByName.get(m.from)?.has(m.pk) ? "verified" : "forged";
      trust.set(m.seq, t);
      if (t === "forged" || !member) {
        rejected.set(m.seq, member ? `not signed by ${m.from}'s key` : `${m.from} isn't a member`);
        continue;
      }
      (member.ops ??= {})[m.pk!] = m.ops ?? 0;
      const first = sent.get(m.id) ?? (old.size ? old.get(idHash(m.id)) : undefined);
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
        rejected.set(m.seq, "signed too long before the latest messages");
        continue;
      }
      sent.set(m.id, m.seq);
      sentAt.set(m.id, m.ts);
      queue.set(m.id, m.pk!);
      hw = Math.max(hw, Math.min(m.ts, m.rts ?? m.ts));
      if (queue.size > SENT_CAP) {
        const [id, pk] = queue.entries().next().value!;
        queue.delete(id);
        sent.delete(id);
        sentFloors.set(pk, Math.max(sentFloors.get(pk) ?? 0, sentAt.get(id)! + 1));
        sentAt.delete(id);
      }
      if (m.sealed) {
        const room = secret.get(m.sealed.room);
        const why =
          !room?.meta || room.n !== m.sealed.n || !inRoom(room.meta, m.from, m.pk)
            ? `${m.from} wasn't in that private room, or wrote with a key it no longer uses`
            : m.kind === "event" && !isOverlay(m)
              ? "a private room keeps to messages, reactions, edits and deletes: tasks, notes and other channel events would be seen by everyone"
              : null;
        if (why) {
          trust.set(m.seq, "refused");
          rejected.set(m.seq, why);
          continue;
        }
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
        const parent = earlierParent(m);
        const room = (parent !== undefined ? roomOf.get(parent) : undefined) ?? m.room ?? GENERAL_ROOM;
        if (!rooms.has(room)) {
          trust.set(m.seq, "refused");
          rejected.set(m.seq, `no room ${room}`);
          continue;
        }
        roomOf.set(m.seq, room);
        const parentPlace = parent !== undefined ? placeOf.get(parent) : undefined;
        const to = m.to?.length === 1 ? m.to[0]! : undefined;
        const pair = m.dm && to && members.has(to) ? ([rootOf(m.from, members), rootOf(to, members)] as const) : null;
        const place = parentPlace ?? (m.task !== undefined && tasks.has(m.task) ? { kind: "task" as const, task: m.task } : pair && pair[0] !== pair[1] ? dmPlace(pair[0], pair[1]) : MAIN);
        placeOf.set(m.seq, place);
        if (editable(m)) chatBy.set(m.seq, m.from);
        if (m.kind === "done" && m.task !== undefined && tasks.get(m.task)?.state !== "done") rejected.set(m.seq, `${taskId(m.task)} isn't done here`);
        const posted = place.kind === "task" ? tasks.get(place.task) : place.kind === "main" && room !== GENERAL_ROOM ? rooms.get(room) : undefined;
        if (posted && !posted.posters?.includes(m.from)) posted.posters = [...(posted.posters ?? []), m.from];
        if (place.kind === "task") touch(tasks.get(place.task), m.from, at);
      }
      member.lastSeen = Math.max(member.lastSeen, at);
      if (!isOverlay(m)) member.messages++;

      for (const r of m.re ?? []) {
        if (!(r < m.seq)) continue;
        let set = answered.get(r);
        if (!set) answered.set(r, (set = new Set()));
        set.add(m.from);
        if (m.perm) {
          let replies = permReplies.get(r);
          if (!replies) permReplies.set(r, (replies = []));
          replies.push(m);
          permBySeq.set(m.seq, m);
        }
        if (!m.settled) continue;
        let settlers = settledBy.get(r);
        if (!settlers) settledBy.set(r, (settlers = new Set()));
        settlers.add(m.from);
      }

      if (m.kind !== "event") {
        const parent = earlierParent(m);
        const root = parent === undefined ? m.seq : (threadOf.get(parent) ?? parent);
        threadOf.set(m.seq, root);
        if (isPerson(member)) askHeads.set(m.seq, askHeadOf(m, at));
        let people = threadPeople.get(root);
        if (!people) threadPeople.set(root, (people = new Set()));
        people.add(m.from);
        for (const t of m.to ?? []) if (!t.startsWith("role:")) people.add(t);
      }

      if (m.kind === "event" && m.newer !== undefined) {
        skipped = true;
        placeOf.set(m.seq, MAIN);
        continue;
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
      if (ev.op === "msg.edit" || ev.op === "msg.delete") {
        const author = ev.seq < m.seq ? chatBy.get(ev.seq) : undefined;
        if (author === undefined) reject(`no message #${ev.seq} that can be edited or deleted`);
        else if (!sameAuthor(members.get(author), member)) reject(`only who wrote #${ev.seq} edits or deletes it`);
        else if (deleted.has(ev.seq)) reject(`#${ev.seq} is already deleted`);
        else if (ev.op === "msg.edit") edits.set(ev.seq, { body: ev.body, at, seq: m.seq });
        else {
          deleted.set(ev.seq, at);
          edits.delete(ev.seq);
        }
        continue;
      }
      if (ev.op === "ask.close") {
        placeOf.set(m.seq, placeOf.get(ev.ask) ?? MAIN);
        const asker = askers.get(ev.ask);
        if (asker === undefined || !(ev.ask < m.seq)) reject(`#${ev.ask} isn't a question or a step waiting on someone`);
        else if (asker !== m.from && !isPerson(member)) reject("only who asked, or a person, closes an ask");
        else closedAsks.add(ev.ask);
        continue;
      }
      if (ev.op === "ask.name") {
        placeOf.set(m.seq, MAIN);
        const head = askHeads.get(ev.ask);
        const goal = ev.name === null ? null : inlineText(ev.name, MAX_GOAL_NAME);
        if (!head) reject(`#${ev.ask} isn't a person's message that tasks are filed under`);
        else if (!leads(member) && head.by !== m.from) reject("only the lead, the owner or the person who asked names a goal");
        else if (goal === "") reject("a goal needs a name");
        else if (goal === null) askHeads.set(head.id, omit(head, "goal", "goalBy"));
        else askHeads.set(head.id, { ...head, goal, goalBy: m.from });
        continue;
      }
      placeOf.set(
        m.seq,
        ev.op === "task.add"
          ? { kind: "task", task: m.seq }
          : (ev.op === "task.update" || ev.op === "task.claim" || ev.op === "task.first") && tasks.has(ev.task)
            ? { kind: "task", task: ev.task }
            : MAIN,
      );

      applyEvent(ctx, m, ev, member, at, reject);
      const added = ev.op === "task.add" && !rejected.has(m.seq) ? tasks.get(m.seq) : undefined;
      if (added) {
        const re = earlierParent(m);
        const ask = fileTask({ askHeads, threadOf, placeOf, tasks }, added, re, isPerson(member), at);
        if (ask !== undefined) added.ask = ask;
      }
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
    if (ignored(trust.get(m.seq)) || closedAsks.has(m.seq)) return false;
    if (m.permission)
      return !(settledBy.get(m.seq)?.has(m.from) || now > m.permission.expiresAt || (permReplies.get(m.seq) ?? []).some((r) => permissionAnswer(m, r, { trust, members, bySeq: permBySeq }) !== null));
    const by = answered.get(m.seq);
    return !by || ![...by].some((n) => answersAsk(members, m, n));
  });

  const cut = head - KEEP_SEQS;
  const keyIndex = new Map<string, number>();
  const keptSent = [...queue].map(([id, pk]): [string, number, number, number] => [id, sent.get(id)!, sentAt.get(id)!, keyIndex.get(pk) ?? keyIndex.set(pk, keyIndex.size).size - 1]);
  const carded = (t: Task) => (t.state === "done" || t.cancelled) && closedLongAgo(t.updatedAt, hw);
  const taskIssues = new Set([...tasks.values()].flatMap((t) => (t.issue && !carded(t) ? [prKey(t.issue.repo, t.issue.number)] : [])));
  const recent = <T>(pairs: Iterable<[number, T]>) => [...pairs].filter(([seq]) => seq > cut);
  const keptThreads = recent(threadOf);
  const keptRoots = new Set(keptThreads.map(([, root]) => root));
  const filedUnder = new Set([...tasks.values()].flatMap((t) => (t.ask !== undefined ? [t.ask] : [])));
  keep?.(
    structuredClone({
      n: head,
      members: [...members.values()].map((m) => ({
        name: m.name,
        role: m.role,
        about: m.about,
        color: m.color,
        picture: m.picture,
        card: m.card,
        lastSeen: m.lastSeen,
        messages: m.messages,
        ...(m.ops ? { ops: { ...m.ops } } : {}),
      })),
      lead,
      charter: ctx.charter,
      compact: ctx.compact,
      compactProposal: ctx.compactProposal,
      repos: ctx.repos,
      github: {
        prs: [...ctx.github.prs.values()].filter((p) => p.state === "open" || !closedLongAgo(p.at, hw)),
        checks: [...ctx.github.checks].map(([k, runs]) => [k, [...runs.values()]]),
        issues: [...ctx.github.issues.values()].filter((i) => i.state === "open" || !closedLongAgo(i.at, hw) || taskIssues.has(prKey(i.repo, i.number))),
        rules: [...ctx.github.rules.values()],
        releases: [...ctx.github.releases.values()].flat(),
      },
      hold: ctx.hold,
      githubWrite: ctx.githubWrite,
      branchPrefix: ctx.branchPrefix,
      scopesByKey: [...scopesByKey],
      scopeSets: [...scopeSets],
      roleSets: [...roleSets],
      tasks: [...tasks.values()].map((t) => (carded(t) ? card(t) : t)),
      facts: [...facts.values()],
      leases: [...leases.values()],
      reactions: recent(reactions).map(([seq, by]): [number, [string, Reaction][]] => [seq, [...by]]),
      reactSeqs: [...reactSeqs].filter((seq) => seq > cut),
      chatBy: recent(chatBy),
      edits: recent(edits),
      deleted: recent(deleted),
      trust: recent(trust),
      rejected: recent(rejected),
      sent: keptSent,
      oldSent: [...old].map(([hash, seq]): [number, number] => [seq, hash]),
      sentKeys: [...keyIndex.keys()],
      sentFloors: [...sentFloors].filter(([, floor]) => floor > hw - SENT_WINDOW_MS),
      hw,
      placesBefore: [...summarize(new Map([...placeOf].filter(([seq]) => seq <= cut)), tasks, trust, placesBefore).values()].map((p): [Place, number, number] => [p.place, p.count, p.last]),
      asks: openAsks.map((m) => (m.imgs?.length ? { ...m, imgs: m.imgs.map((i) => omit(i, "data")) } : m)),
      askHeads: [...askHeads.values()].filter((h) => h.id > cut || filedUnder.has(h.id)),
      answered: openAsks.flatMap((m): [number, string[]][] => [[m.seq, [...(answered.get(m.seq) ?? [])]]]),
      threadOf: keptThreads,
      threadPeople: [...threadPeople].filter(([root]) => root > cut || keptRoots.has(root)).map(([seq, people]): [number, string[]] => [seq, [...people]]),
      rooms: [...rooms.values()],
      secret: [...secret].map(([id, r]): [string, SecretRoom] => [id, { ...r }]),
      roomOf: recent(roomOf),
      placeOf: recent(placeOf),
      personaLeads: [...personaLead],
      powers: [...powers].map(([name, p]): [string, Partial<Record<Power, boolean>>] => [name, { ...p }]),
      folded: EVENT_OPS_VERSION,
      rules: from ? Math.min(from.rules ?? 0, FOLD_RULES) : FOLD_RULES,
      ...(skipped ? { skipped: true as const } : {}),
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

  for (const t of [...tasks.values()]) {
    if (t.state === "done" || !t.owner || members.get(t.owner)?.active !== false) continue;
    tasks.set(t.id, { ...omit(t, "owner"), leftBy: t.owner, ...(t.state === "doing" ? { state: "todo" as const } : {}) });
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
    askHeads,
    threadOf,
    threadPeople,
    lead: theLead ?? null,
    rooms,
    secret,
    roomOf,
    placeOf,
    places: summarize(placeOf, tasks, trust, placesBefore),
    charter: ctx.charter,
    compact: ctx.compact,
    compactProposal: ctx.compactProposal,
    repos: ctx.repos,
    github: ctx.github,
    hold: ctx.hold,
    githubWrite: ctx.githubWrite,
    branchPrefix: ctx.branchPrefix,
    reactions,
    edits,
    deleted,
    head,
  };
}
