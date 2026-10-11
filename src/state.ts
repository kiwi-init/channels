// Shared channel state, folded from the message log.
//
// Every client folds the same signed events in the same (relay-assigned)
// order, so they all agree on who owns which task, which paths are claimed,
// and what the facts are, without the relay ever reading any of it.
// Conflicts resolve deterministically: the earlier sequence number wins.

import { inlineText } from "./membership.ts";
import { GENERAL_ROOM, ignored, MAX_CHARTER, MAX_ROOM_NAME, MAX_ROOMS, MAX_TAGS, ROOM_ID_RE, type Card, type Color, type Handoff, type Message, type TaskState, type Trust } from "./protocol.ts";
import { readScopes, refusal, SCOPES, scopesOf, type Scope } from "./scopes.ts";

export interface Member {
  name: string;
  kind?: "human" | "agent";
  display?: string;
  sponsor?: { user: string; name: string; handle?: string };
  /** The key the owner admitted under this name. */
  pk: string;
  role?: string;
  about?: string;
  /** A role (or rules) they asked for and the owner hasn't decided on yet. */
  roleRequest?: { role?: string; about?: string; seq: number; at: number };
  /** A person's colour; agents wear their person's (colorOf). */
  color?: Color;
  /** What they may do besides read, after every scope.set so far (see scopes.ts). */
  scopes: Scope[];
  /** What they last said about themselves: where they run, what runs them, what they can use. */
  card?: Card & { at: number };
  owner: boolean;
  /** When the owner admitted them. */
  joined: number;
  /** False once they've left or been removed (their history still verifies). */
  active: boolean;
  lastSeen: number;
  messages: number;
}

/** The verified member list, as names → admitted keys (see membership.ts). */
export type Roster = {
  name: string;
  pk: string;
  role?: string;
  about?: string;
  owner: boolean;
  at: number;
  active: boolean;
  kind?: "human" | "agent";
  display?: string;
  sponsor?: { user: string; name: string; handle?: string };
  color?: Color;
  /** As the owner signed them into this key's record; absent is everything. */
  scopes?: Scope[];
  /** What the owner re-signed this key's record to after a change: from log position `since` on. */
  later?: { scopes: Scope[]; since: number };
  /** The role (and rules) the owner re-signed this key's record to after a role.set at `since`. */
  laterRole?: { role: string | null; about?: string | null; since: number };
}[];

export interface TaskNote {
  seq: number;
  by: string;
  ts: number;
  text: string;
  /** Set when this note handed the task over: where to pick the work up. */
  handoff?: Handoff;
}

export interface Task {
  id: number;
  title: string;
  detail?: string;
  state: TaskState;
  owner?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** Tasks that must be done before this one. */
  after: number[];
  notes: TaskNote[];
  /** What doing it takes, as tags matched against members' cards (lowercase). */
  needs: string[];
  /** Who must approve it before it's done: a member, or "*" for anyone who hasn't worked on it. */
  review?: string;
  /** Who approved it, when a review let it be done. */
  approvedBy?: string;
  /** Everyone who has owned it or moved it along: none of them may approve it under a "*" review. */
  workedBy: string[];
}

export interface Claim {
  owner: string;
  path: string;
  seq: number;
  since: number;
  expires: number;
  note?: string;
  /** This computer's label, when the claim recorded one. */
  machine?: string;
  /** Git checkout the claim was made from, so another agent can see which tree it guards. */
  checkout?: string;
}

export interface Fact {
  key: string;
  value: string;
  by: string;
  ts: number;
  seq: number;
  /** When a --ttl fact stops being visible. Absent facts stay until unset. */
  expires?: number;
}

export interface ChannelState {
  members: Map<string, Member>;
  tasks: Map<number, Task>;
  /** Claims active at fold time. */
  claims: Claim[];
  facts: Map<string, Fact>;
  trust: Map<number, Trust>;
  /** Events that lost a race or broke a rule, with the reason. */
  rejected: Map<number, string>;
  /** Per key, the latest scope.set in the log (its seq and what it set). */
  scopeSets: Map<string, { seq: number; scopes: Scope[] }>;
  /** Per member name, the latest role.set in the log: the owner's client checks the record says it too. */
  roleSets: Map<string, { seq: number; role: string | null; about?: string | null }>;
  /** Asks and blockers nobody else has replied to. */
  openAsks: Message[];
  /** Each verified chat message's thread: the seq at the top of its reply chain (itself if it starts one). */
  threadOf: Map<number, number>;
  /** Who's in each thread (by its root): everyone who wrote in it or was named in it. */
  threadPeople: Map<number, Set<string>>;
  /** Coordinator-only, as the owner last set it (off unless they turned it on). */
  mode: { coordinatorOnly: boolean; strict: boolean };
  /** The member whose role is "coordinator" (at most one), or null. */
  coordinator: string | null;
  /** Agents' messages to people in coordinator-only mode, sent directly instead of through the coordinator. */
  direct: Set<number>;
  /** The channel's rooms by id, general first (every channel has it). */
  rooms: Map<string, Room>;
  /** Each counted chat message's room (an id). A reply is in its parent's room. */
  roomOf: Map<number, string>;
  /** What the channel is for and where its limits are, as the owner last set it; null if never. */
  charter: Charter | null;
  /** Set while the owner has every agent stopped; null otherwise. */
  hold: Hold | null;
  head: number;
}

/** The owner's word on what the channel is for. Agents work within it and escalate what falls outside. */
export interface Charter {
  text: string;
  by: string;
  /** When it was set (0 when known only from the signed settings). */
  at: number;
}

/** The owner stopped every agent. */
export interface Hold {
  note?: string;
  by: string;
  at: number;
}

/**
 * The charter and the hold the owner signed into the channel's settings, each as of log position
 * `since`: a client holding only the log's tail may not have those events. Any later one still applies.
 */
export interface GuardFloor {
  charter: { text: string | null; since: number } | null;
  hold: { on: boolean; note?: string; since: number } | null;
}

/**
 * What an agent may still send while the channel is on hold: answers to people (every recipient a
 * person) and housekeeping that changes nothing (announcing itself, letting go of claims).
 */
export function allowedOnHold(m: Pick<Message, "kind" | "to" | "ev">, isPersonName: (name: string) => boolean): boolean {
  if (m.kind === "event") return m.ev?.op === "hello" || m.ev?.op === "release";
  return !!m.to?.length && !m.to.includes("*") && m.to.every(isPersonName);
}

/** Why a message from an agent is refused while on hold. */
export const ON_HOLD = "the owner put the channel on hold: agents may only answer people until it's lifted";

export interface Room {
  /** Never changes (see ROOM_ID_RE). */
  id: string;
  name: string;
  /** Who made it, when that event is in the folded log (null for general, or a room known only from the owner's signed list). */
  createdBy: string | null;
  at: number;
}

/** The room list the owner signed into the channel's settings, as it stood after log position `since`. */
export interface RoomsFloor {
  list: { id: string; name: string }[];
  since: number;
}

/**
 * Strict coordinator-only, from a person's side: a chat message from an agent other than the
 * coordinator never reaches them, however its recipients are spelled (a broadcast, *, a thread
 * reply). Events still do. The sender-side refusal in fold only catches messages that name a person.
 */
export function keptFromPeople(state: ChannelState, m: Message): boolean {
  if (!state.mode.coordinatorOnly || !state.mode.strict || !state.coordinator || m.kind === "event" || m.esc) return false;
  const from = state.members.get(m.from);
  return !!from && !isPerson(from) && m.from !== state.coordinator;
}

/** A room's name as it's shown: one line, bounded. Empty means no name. */
export function roomName(name: unknown): string {
  return inlineText(name, MAX_ROOM_NAME);
}

/** The room a name or id points to: the id first, then the name (names are unique, case aside). */
export function findRoom(state: ChannelState, nameOrId: string): Room | null {
  const t = nameOrId.trim().replace(/^#/, "");
  return state.rooms.get(t) ?? [...state.rooms.values()].find((r) => r.name.toLowerCase() === t.toLowerCase()) ?? null;
}

/** A new room id: 8 random characters from [a-z0-9]. Made once by the owner's client; it never changes. */
export function newRoomId(): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => abc[b % abc.length]).join("");
}

/** The role that makes a member the channel's coordinator. */
export const COORDINATOR = "coordinator";
const isCoordinatorRole = (role: string | undefined) => role?.trim().toLowerCase() === COORDINATOR;

export function taskId(id: number): string {
  return `T${id}`;
}

/** Parse "T12", "t12", "#12" or "12". */
export function parseTaskId(s: string): number | null {
  const m = /^(?:[Tt#])?(\d+)$/.exec(s.trim());
  return m ? Number(m[1]) : null;
}

/** `file#Symbol` is a claim on one function. Anything else, including a trailing slash, is the whole path. */
export function splitClaim(path: string): { file: string; symbol?: string } {
  const hash = path.lastIndexOf("#");
  if (hash > 0) {
    const symbol = path.slice(hash + 1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol)) return { file: path.slice(0, hash).replace(/\/+$/, ""), symbol };
  }
  return { file: path.replace(/\/+$/, "") };
}

/**
 * Two claims overlap when one path contains the other ("*" covers everything).
 * `file#A` and `file#B` do not: a symbol claim shares the file. A whole-file claim still locks every symbol in it.
 */
export function overlaps(a: string, b: string): boolean {
  const ca = splitClaim(a);
  const cb = splitClaim(b);
  const x = ca.file;
  const y = cb.file;
  if (x === "*" || y === "*") return true;
  if (x !== y) return x.startsWith(y + "/") || y.startsWith(x + "/");
  if (!ca.symbol || !cb.symbol) return true;
  return ca.symbol === cb.symbol;
}

/** Why a new claim lost: name the other checkout when the claim recorded one. */
export function claimConflict(c: Claim): string {
  return c.checkout ? `${c.path} is claimed by ${c.owner} in ${c.owner}'s checkout (${c.checkout})` : `${c.path} is claimed by ${c.owner}`;
}

/**
 * Fold the log into shared state. A message counts only if it's signed by the
 * key the owner admitted under the name it claims; anything else is forged and
 * ignored, whoever sent it.
 */
export function fold(
  messages: Message[],
  roster: Roster,
  now = Date.now(),
  modeFloor?: { coordinatorOnly: boolean; strict: boolean; since: number } | null,
  roomsFloor?: RoomsFloor | null,
  guardFloor?: GuardFloor | null,
): ChannelState {
  const members = new Map<string, Member>();
  // A name can be re-admitted under a new key after its old one left; the active key wins.
  for (const r of [...roster].sort((a, b) => Number(a.active) - Number(b.active))) {
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
      owner: r.owner,
      joined: r.at,
      lastSeen: r.at,
      messages: 0,
      active: r.active,
    });
  }
  // Every key the owner ever admitted under each name. Normally one per name; a name can have
  // had an earlier holder who left, and the owner may (wrongly) have admitted two keys under one.
  // Colours from admission records are unique too: if two people's records share one, who joined first keeps it.
  const worn = new Set<string>();
  for (const m of [...members.values()].filter((x) => x.active && isPerson(x)).sort((a, b) => a.joined - b.joined)) {
    if (m.color && worn.has(m.color)) m.color = undefined;
    else if (m.color) worn.add(m.color);
  }
  // One coordinator: if records give two members the role, who joined first keeps it.
  let coordinator: string | null = null;
  for (const m of [...members.values()].filter((x) => x.active && isCoordinatorRole(x.role)).sort((a, b) => a.joined - b.joined)) {
    if (coordinator) m.role = undefined;
    else coordinator = m.name;
  }
  let mode = { coordinatorOnly: false, strict: false };
  // The mode the owner signed into the channel's settings, from log position `since` on: a client
  // holding only the log's tail (the web) may not have that mode.set. Any later one still applies.
  let floor = modeFloor ?? null;
  const passFloor = (seq: number) => {
    if (floor && floor.since < seq) {
      mode = { coordinatorOnly: floor.coordinatorOnly, strict: floor.coordinatorOnly && floor.strict };
      floor = null;
    }
  };
  // The charter and the hold, the same way: the owner's signed settings are the floor from `since` on.
  const ownerName = [...members.values()].find((x) => x.owner)?.name ?? "owner";
  let charter: Charter | null = null;
  let hold: Hold | null = null;
  let charterFloor = guardFloor?.charter ?? null;
  let holdFloor = guardFloor?.hold ?? null;
  const passGuard = (seq: number) => {
    if (charterFloor && charterFloor.since < seq) {
      charter = charterFloor.text ? { text: charterFloor.text, by: ownerName, at: charter?.at ?? 0 } : null;
      charterFloor = null;
    }
    if (holdFloor && holdFloor.since < seq) {
      hold = holdFloor.on ? { ...(holdFloor.note ? { note: holdFloor.note } : {}), by: ownerName, at: hold?.at ?? 0 } : null;
      holdFloor = null;
    }
  };
  const direct = new Set<number>();
  /** The person (a member here) whose account vouched for an agent. */
  const humanFor = (a: Member) => (a.sponsor ? [...members.values()].find((x) => x.active && isPerson(x) && x.sponsor?.user === a.sponsor!.user)?.name : undefined);
  const keysByName = new Map<string, Set<string>>();
  for (const r of roster) {
    let set = keysByName.get(r.name);
    if (!set) keysByName.set(r.name, (set = new Set()));
    set.add(r.pk);
  }
  // What each key may do: scopes belong to a key, so a name admitted again under a new key starts
  // from its own record, and an old key's history is judged by what that key was allowed.
  const scopesByKey = new Map<string, Scope[]>();
  for (const r of roster) scopesByKey.set(r.pk, scopesOf(r));
  // The record's later scopes, applied once the log passes where they took effect. A client holding
  // only the tail of the log (the web) never sees that scope.set; this says the same thing. Any
  // scope.set after it, in the log, still applies on top.
  const floors = roster
    .filter((r) => r.later && !r.owner)
    .map((r) => ({ pk: r.pk, ...r.later! }))
    .sort((a, b) => a.since - b.since);
  const passFloors = (seq: number) => {
    while (floors.length && floors[0]!.since < seq) {
      const f = floors.shift()!;
      scopesByKey.set(f.pk, f.scopes);
    }
  };
  /** The latest scope.set the log holds for each key: the owner's client checks the record matches. */
  const scopeSets = new Map<string, { seq: number; scopes: Scope[] }>();
  const roleSets = new Map<string, { seq: number; role: string | null; about?: string | null }>();
  /** A role (and rules) from the owner. The coordinator role has one holder: giving it to someone moves it. */
  const setRole = (target: Member, role: string | null, about: string | null | undefined) => {
    if (isCoordinatorRole(role ?? undefined)) {
      const was = coordinator && members.get(coordinator);
      if (was && was !== target) was.role = undefined;
      coordinator = target.name;
    } else if (coordinator === target.name) coordinator = null;
    target.role = role || undefined;
    if (about !== undefined) target.about = about || undefined;
  };
  // The record's later role, the same way: a client holding only the log's tail never sees an old
  // role.set, so the owner re-signs the record with it; it applies once the log passes `since`.
  const roleFloors = roster
    .filter((r) => r.laterRole && !r.owner && r.active)
    .map((r) => ({ name: r.name, pk: r.pk, ...r.laterRole! }))
    .sort((a, b) => a.since - b.since);
  const passRoleFloors = (seq: number) => {
    while (roleFloors.length && roleFloors[0]!.since < seq) {
      const f = roleFloors.shift()!;
      const target = members.get(f.name);
      if (target?.pk === f.pk) setRole(target, f.role, f.about);
    }
  };
  const tasks = new Map<number, Task>();
  let claims: Claim[] = [];
  const facts = new Map<string, Fact>();
  const trust = new Map<number, Trust>();
  const rejected = new Map<number, string>();
  const answered = new Map<number, Set<string>>();
  const threadOf = new Map<number, number>();
  const threadPeople = new Map<number, Set<string>>();
  let head = 0;

  // Rooms: general always; then the ones the owner signed into the settings, which a client holding only
  // the log's tail may never see created. Room events up to the list's `since` are already in it.
  const rooms = new Map<string, Room>([[GENERAL_ROOM, { id: GENERAL_ROOM, name: GENERAL_ROOM, createdBy: null, at: 0 }]]);
  const roomsSince = roomsFloor?.since ?? -1;
  for (const r of roomsFloor?.list ?? []) {
    const name = roomName(r.name);
    if (!ROOM_ID_RE.test(r.id) || !name || (rooms.size >= MAX_ROOMS && !rooms.has(r.id))) continue;
    rooms.set(r.id, { ...(rooms.get(r.id) ?? { id: r.id, createdBy: null, at: 0 }), name });
  }
  const nameTaken = (name: string, except?: string) => [...rooms.values()].some((r) => r.id !== except && r.name.toLowerCase() === name.toLowerCase());
  const roomOf = new Map<number, string>();

  for (const m of messages) {
    passFloors(m.seq);
    passRoleFloors(m.seq);
    passFloor(m.seq);
    passGuard(m.seq);
    // One bad message must never take the whole channel down for everyone: skip it.
    try {
      head = Math.max(head, m.seq);
      const at = m.rts ?? m.ts;

      // Identity: only a key the owner admitted under this name may speak for it.
      const member = members.get(m.from);
      const t: Trust = m.sigOk && !!m.pk && !!keysByName.get(m.from)?.has(m.pk) ? "verified" : "forged";
      trust.set(m.seq, t);
      if (t === "forged" || !member) {
        rejected.set(m.seq, member ? `not signed by ${m.from}'s key` : `${m.from} isn't a member`);
        continue;
      }
      // Scopes: a message the owner hasn't let this key send counts for nothing, as if never sent.
      const refused = refusal(scopesByKey.get(m.pk!) ?? [], m);
      if (refused) {
        trust.set(m.seq, "refused");
        rejected.set(m.seq, `${m.from} ${refused}`);
        continue;
      }
      // Coordinator-only: an agent other than the coordinator messaging a person. Strict refuses it
      // (as if never sent); otherwise it stands, flagged as sent directly. No coordinator: normal.
      // Escalations: an agent handing a decision to people always reaches them, coordinator or not, but
      // only its own human and the owner, so the way past the coordinator can't become a way to anyone.
      if (m.esc) {
        const may = new Set([humanFor(member), [...members.values()].find((x) => x.owner)?.name].filter(Boolean));
        if (isPerson(member) || m.kind === "event" || !m.to?.length || !m.to.every((n) => may.has(n))) {
          trust.set(m.seq, "refused");
          rejected.set(m.seq, "an escalation goes from an agent to its own human and the owner, no one else");
          continue;
        }
      }
      if (mode.coordinatorOnly && coordinator && m.kind !== "event" && !m.esc && !isPerson(member) && m.from !== coordinator) {
        const people = (m.to ?? []).filter((n) => { const p = members.get(n); return !!p && isPerson(p); });
        if (people.length) {
          if (mode.strict) {
            trust.set(m.seq, "refused");
            rejected.set(m.seq, `only the coordinator (${coordinator}) messages people here`);
            continue;
          }
          direct.add(m.seq);
        }
      }
      // On hold: an agent's work counts for nothing, as if never sent. Answering people still does.
      if (hold && !isPerson(member) && !allowedOnHold(m, (n) => { const p = members.get(n); return !!p && isPerson(p); })) {
        trust.set(m.seq, "refused");
        rejected.set(m.seq, ON_HOLD);
        continue;
      }
      // Rooms: a thread lives in one room, so a reply is in its parent's; anything else is in the room it
      // names, or general. A room that doesn't exist (yet) can't be written in: nobody fills invisible rooms.
      if (m.kind !== "event") {
        const parent = m.re?.[0];
        const room = (parent !== undefined ? roomOf.get(parent) : undefined) ?? m.room ?? GENERAL_ROOM;
        if (!rooms.has(room)) {
          trust.set(m.seq, "refused");
          rejected.set(m.seq, `no room ${room}`);
          continue;
        }
        roomOf.set(m.seq, room);
      }
      member.lastSeen = Math.max(member.lastSeen, at);
      member.messages++;

      for (const r of m.re ?? []) {
        let set = answered.get(r);
        if (!set) answered.set(r, (set = new Set()));
        set.add(m.from);
      }

      // Threads: a reply joins the thread of the message it answers (its first re).
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

      switch (ev.op) {
        case "hello": {
          // Roles are the owner's to give: the owner sets its own, anyone else's hello asks for one.
          if (member.owner) {
            if (ev.role !== undefined) member.role = ev.role || undefined;
            if (ev.about !== undefined) member.about = ev.about || undefined;
            break;
          }
          const role = ev.role === undefined ? member.role : ev.role || undefined;
          const about = ev.about === undefined ? member.about : ev.about || undefined;
          if (role === member.role && about === member.about) member.roleRequest = undefined;
          else member.roleRequest = { ...(role !== undefined ? { role } : {}), ...(about !== undefined ? { about } : {}), seq: m.seq, at };
          break;
        }

        case "room.create": {
          if (!member.owner) {
            reject("only the owner makes rooms");
            break;
          }
          const known = rooms.get(ev.id);
          // Already in the owner's signed list: this is where it began.
          if (known && m.seq <= roomsSince) {
            if (!known.createdBy) Object.assign(known, { createdBy: m.from, at });
            break;
          }
          const name = roomName(ev.name);
          if (ev.id === GENERAL_ROOM || known) reject(`there's already a room ${ev.id}`);
          else if (!name) reject("a room needs a name");
          else if (nameTaken(name)) reject(`a room is already called ${name}`);
          else if (rooms.size >= MAX_ROOMS) reject(`a channel holds at most ${MAX_ROOMS} rooms`);
          else rooms.set(ev.id, { id: ev.id, name, createdBy: m.from, at });
          break;
        }

        case "room.rename": {
          if (!member.owner) {
            reject("only the owner names rooms");
            break;
          }
          const room = rooms.get(ev.id);
          const name = roomName(ev.name);
          if (!room) reject(`no room ${ev.id}`);
          // The signed list already has every rename up to its `since`.
          else if (m.seq <= roomsSince) break;
          else if (!name) reject("a room needs a name");
          else if (nameTaken(name, room.id)) reject(`a room is already called ${name}`);
          else room.name = name;
          break;
        }

        case "mode.set": {
          if (!member.owner) {
            reject("only the owner sets the channel's mode");
            break;
          }
          mode = { coordinatorOnly: ev.coordinatorOnly, strict: ev.coordinatorOnly && ev.strict };
          break;
        }

        case "charter.set": {
          if (!member.owner) {
            reject("only the owner sets the charter");
            break;
          }
          const text = ev.text?.trim().slice(0, MAX_CHARTER);
          charter = text ? { text, by: m.from, at } : null;
          break;
        }

        case "hold.set": {
          if (!member.owner) {
            reject("only the owner puts the channel on hold");
            break;
          }
          hold = ev.on ? { ...(ev.note?.trim() ? { note: ev.note.trim().slice(0, 500) } : {}), by: m.from, at } : null;
          break;
        }

        case "role.set":
        case "role.refuse": {
          if (!member.owner) {
            reject("only the owner decides roles");
            break;
          }
          const target = members.get(ev.member);
          if (!target) {
            reject(`no member named ${ev.member}`);
            break;
          }
          if (ev.op === "role.set") {
            setRole(target, ev.role, ev.about);
            roleSets.set(target.name, { seq: m.seq, role: ev.role, ...(ev.about !== undefined ? { about: ev.about } : {}) });
          }
          target.roleRequest = undefined;
          break;
        }

        case "scope.set": {
          if (!member.owner) {
            reject("only the owner sets what members may do");
            break;
          }
          if (!keysByName.get(ev.member)?.has(ev.pk)) {
            reject(members.has(ev.member) ? `that key isn't ${ev.member}'s` : `no member named ${ev.member}`);
            break;
          }
          if (members.get(ev.member)?.owner) {
            reject("the owner may do everything");
            break;
          }
          const scopes = ev.scopes === null ? [...SCOPES] : (readScopes(ev.scopes) ?? []);
          scopesByKey.set(ev.pk, scopes);
          scopeSets.set(ev.pk, { seq: m.seq, scopes });
          // Losing claims lets go of the ones held now; tasks they own stay theirs until reassigned.
          if (!scopes.includes("claims")) claims = claims.filter((c) => c.owner !== ev.member);
          break;
        }

        case "seat.reclaim":
          // The record: the seat itself moved when the owner signed the new key's member record.
          if (!member.owner) reject("only the owner moves a seat to a new key");
          else if (!members.has(ev.member)) reject(`no member named ${ev.member}`);
          break;

        case "color.set": {
          // A person picks their own colour; the owner may set or clear anyone's.
          const target = members.get(ev.member);
          if (!target?.active) reject(`no member named ${ev.member}`);
          else if (ev.member !== m.from && !member.owner) reject("only that person or the owner sets a colour");
          else if (!isPerson(target)) reject("agents wear their person's colour; they don't have their own");
          else {
            const holder = ev.color && [...members.values()].find((x) => x.active && x.name !== target.name && isPerson(x) && x.color === ev.color);
            if (holder) reject(`${ev.color} is ${holder.name}'s colour`);
            else target.color = ev.color ?? undefined;
          }
          break;
        }

        case "task.add":
          tasks.set(m.seq, {
            id: m.seq,
            title: String(ev.title).slice(0, 200),
            detail: ev.detail,
            state: "todo",
            owner: ev.owner || undefined,
            createdBy: m.from,
            createdAt: at,
            updatedAt: at,
            after: (ev.after ?? []).filter((d) => tasks.has(d)),
            notes: [],
            needs: normTags(ev.needs),
            ...(ev.review?.trim() ? { review: ev.review.trim() } : {}),
            workedBy: ev.owner ? [ev.owner] : [],
          });
          break;

        case "card": {
          const { op: _op, ...card } = ev;
          member.card = { ...card, ...(card.tools ? { tools: normTags(card.tools) } : {}), at };
          break;
        }

        case "task.claim": {
          const task = tasks.get(ev.task);
          if (!task) reject(`no task ${taskId(ev.task)}`);
          else if (task.state === "done") reject(`${taskId(task.id)} is already done`);
          else if (task.state === "cancelled") reject(`${taskId(task.id)} is cancelled`);
          else if (task.owner && task.owner !== m.from) reject(`${taskId(task.id)} is owned by ${task.owner}`);
          else {
            task.owner = m.from;
            if (task.state === "todo") task.state = "doing";
            task.updatedAt = at;
            worked(task, m.from);
          }
          break;
        }

        case "task.update": {
          const task = tasks.get(ev.task);
          if (!task) {
            reject(`no task ${taskId(ev.task)}`);
            break;
          }
          // A review gate is set by whoever adds it; once set, only a person or the reviewer moves it,
          // so the agent doing the work can't wave its own review away.
          if (ev.review !== undefined && task.review && !isPerson(member) && m.from !== task.review) {
            reject(`only a person or ${task.review === "*" ? "a reviewer" : task.review} changes who reviews ${taskId(task.id)}`);
            break;
          }
          const review = ev.review === undefined ? task.review : ev.review?.trim() || undefined;
          // Done, with a review: only the reviewer (or for "*", anyone who hasn't worked on it) says so.
          // People may always. Handing it to someone first doesn't make the doer a reviewer.
          if (ev.state === "done" && task.state !== "done" && review) {
            const owner = ev.owner === undefined ? task.owner : ev.owner || undefined;
            const ok = isPerson(member) || (review === "*" ? m.from !== owner && !task.workedBy.includes(m.from) : m.from === review);
            if (!ok) {
              reject(`${taskId(task.id)} needs review by ${review === "*" ? "someone who hasn't worked on it" : review} before it's done (send it for review)`);
              break;
            }
          }
          if (ev.after?.length) {
            const why = appendAfter(tasks, task, ev.after);
            if (why) {
              reject(why);
              break;
            }
          }
          if (ev.review !== undefined) task.review = review;
          if (ev.state === "done" && task.state !== "done" && task.review) task.approvedBy = m.from;
          if (ev.state && ev.state !== "done") task.approvedBy = undefined;
          if (ev.owner !== undefined) task.owner = ev.owner || undefined;
          if (ev.owner) worked(task, ev.owner);
          // Moving it along as its owner, or sending it for review, is working on it; a reviewer sending it back isn't.
          if (ev.state && ev.state !== "done" && ev.state !== "cancelled" && (m.from === task.owner || ev.state === "review")) worked(task, m.from);
          if (ev.state) task.state = ev.state;
          if (ev.title) task.title = ev.title.slice(0, 200);
          if (ev.note || ev.handoff) task.notes.push({ seq: m.seq, by: m.from, ts: at, text: ev.note ?? "", ...(ev.handoff ? { handoff: ev.handoff } : {}) });
          // Unassigning work in progress puts it back on the board.
          if (ev.owner === null && task.state === "doing") task.state = "todo";
          task.updatedAt = at;
          break;
        }

        case "claim": {
          const live = claims.filter((c) => c.expires > at);
          const ttl = Math.min(Math.max(Number(ev.ttl) || 0, 60), 24 * 3600) * 1000;
          const conflict = ev.paths
            .map((p) => live.find((c) => c.owner !== m.from && overlaps(c.path, p)))
            .find(Boolean);
          if (conflict) {
            reject(claimConflict(conflict));
            break;
          }
          claims = live.filter((c) => !(c.owner === m.from && ev.paths.includes(c.path)));
          const place = { ...(ev.machine ? { machine: ev.machine } : {}), ...(ev.checkout ? { checkout: ev.checkout } : {}) };
          for (const path of ev.paths) {
            claims.push({ owner: m.from, path, seq: m.seq, since: at, expires: at + ttl, note: ev.note, ...place });
          }
          break;
        }

        case "release":
          claims = claims.filter((c) => c.owner !== m.from || (ev.paths?.length ? !ev.paths.includes(c.path) : false));
          break;

        case "fact.set": {
          const ttl = ev.ttl === undefined ? undefined : Math.min(Math.max(Number(ev.ttl) || 0, 60), 30 * 24 * 3600) * 1000;
          facts.set(ev.key, { key: ev.key, value: ev.value, by: m.from, ts: at, seq: m.seq, ...(ttl ? { expires: at + ttl } : {}) });
          break;
        }

        case "fact.del":
          facts.delete(ev.key);
          break;
      }
      } catch {
      trust.set(m.seq, "forged");
      rejected.set(m.seq, "malformed message");
    }
  }

  const openAsks = messages.filter((m) => {
    if (m.kind !== "ask" && m.kind !== "blocking") return false;
    if (ignored(trust.get(m.seq))) return false;
    const by = answered.get(m.seq);
    return !by || [...by].every((n) => n === m.from);
  });

  // Floors the loaded log hasn't passed yet: the record is newer than anything here says.
  passFloors(Infinity);
  passRoleFloors(Infinity);
  for (const member of members.values()) member.scopes = scopesByKey.get(member.pk) ?? [];
  for (const [key, fact] of facts) if (fact.expires !== undefined && fact.expires <= now) facts.delete(key);

  // A floor past the end of what's loaded: the settings are newer than this tail.
  passFloor(Infinity);
  passGuard(Infinity);
  return {
    members,
    tasks,
    claims: claims.filter((c) => c.expires > now),
    facts,
    trust,
    scopeSets,
    roleSets,
    rejected,
    openAsks,
    threadOf,
    threadPeople,
    mode,
    coordinator: coordinator && members.get(coordinator)?.active ? coordinator : null,
    direct,
    rooms,
    roomOf,
    charter,
    hold,
    head,
  };
}

function worked(task: Task, name: string): void {
  if (!task.workedBy.includes(name)) task.workedBy.push(name);
}

/** A dependency that no longer blocks: finished, in review, or cancelled. */
export function depSatisfied(state: TaskState | undefined): boolean {
  return state === "done" || state === "review" || state === "cancelled";
}

/** Tasks still waiting on unfinished dependencies. Review, done and cancelled count as ready. */
export function waitingOn(state: ChannelState, task: Task): number[] {
  return task.after.filter((d) => !depSatisfied(state.tasks.get(d)?.state));
}

/** True if making `task` wait on `dep` would loop (including waiting on itself). */
export function wouldCycle(tasks: Map<number, Task>, task: number, dep: number): boolean {
  if (dep === task) return true;
  const seen = new Set<number>();
  const stack = [dep];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === task) return true;
    if (!seen.add(id)) continue;
    const next = tasks.get(id);
    if (next) for (const d of next.after) stack.push(d);
  }
  return false;
}

function appendAfter(tasks: Map<number, Task>, task: Task, deps: number[]): string | undefined {
  for (const d of deps) {
    if (!tasks.has(d)) return `no task ${taskId(d)}`;
    if (wouldCycle(tasks, task.id, d)) return `${taskId(task.id)} waiting on ${taskId(d)} would cycle`;
  }
  for (const d of deps) if (!task.after.includes(d)) task.after.push(d);
  return undefined;
}

const OPEN_FOR_TITLE = new Set<TaskState>(["todo", "doing", "blocked", "review"]);

function normTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Equal, one title contains the other, or at least 60% of the shorter title's words (longer than 2 characters) overlap. */
export function titlesLookAlike(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = shorter === na ? nb : na;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  const wa = [...new Set(na.split(" ").filter((w) => w.length > 2))];
  const wb = new Set(nb.split(" ").filter((w) => w.length > 2));
  if (!wa.length || !wb.size) return false;
  const shared = wa.filter((w) => wb.has(w)).length;
  return shared / Math.min(wa.length, wb.size) >= 0.6;
}

/** Open tasks (not done, not cancelled) whose title looks like `title`. */
export function similarOpenTasks(state: ChannelState, title: string): Task[] {
  return [...state.tasks.values()].filter((t) => OPEN_FOR_TITLE.has(t.state) && titlesLookAlike(title, t.title)).sort((a, b) => a.id - b.id);
}

/** A person, as opposed to an agent: people sign in; the owner is always one. */
export const isPerson = (m: { kind?: string; owner?: boolean }) => m.kind === "human" || !!m.owner;

/**
 * The person an agent acts for, when that person is a member here: the one whose signed-in account
 * vouched for it. Null for a person, or an agent whose person isn't in the channel.
 */
export function humanOf(state: ChannelState, name: string): string | null {
  const m = state.members.get(name);
  if (!m || isPerson(m) || !m.sponsor) return null;
  return [...state.members.values()].find((x) => x.active && isPerson(x) && x.sponsor?.user === m.sponsor!.user)?.name ?? null;
}

/** The channel owner's member name. */
export function ownerOf(state: ChannelState): string | null {
  return [...state.members.values()].find((x) => x.owner && x.active)?.name ?? null;
}

/** The colour someone shows: a person's own, an agent's person's (when that person is a member here), else null. */
export function colorOf(state: ChannelState, name: string): Color | null {
  const m = state.members.get(name);
  if (!m) return null;
  if (isPerson(m)) return m.color ?? null;
  const person = m.sponsor && [...state.members.values()].find((x) => x.active && isPerson(x) && x.sponsor?.user === m.sponsor!.user);
  return person ? (person.color ?? null) : null;
}

/** Tags as matched: lowercase, trimmed, no empties or repeats. */
export function normTags(tags: readonly string[] | undefined): string[] {
  return [...new Set((tags ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_TAGS);
}

/**
 * Everything a member can be matched by: its card (os, arch, harness, model, tools, the repo and its
 * name alone, the branch) and its role's words. Lowercase.
 */
export function memberTags(m: Member): Set<string> {
  const c = m.card;
  const out = new Set<string>();
  const add = (x: string | undefined) => x && out.add(x.trim().toLowerCase());
  if (c) {
    for (const x of [c.os, c.arch, c.harness, c.model, c.repo, c.branch]) add(x);
    if (c.repo?.includes("/")) add(c.repo.split("/").pop());
    for (const t of c.tools ?? []) add(t);
  }
  for (const w of (m.role ?? "").split(/[\s,/]+/)) add(w);
  return out;
}

/** What `need` asks of a member that it doesn't have. */
export function missingNeeds(m: Member, needs: readonly string[]): string[] {
  const has = memberTags(m);
  return needs.filter((n) => !has.has(n));
}

/**
 * The agents that have everything a task needs, least busy first (then by name). People don't carry
 * cards; they pick work up themselves.
 */
export function fits(state: ChannelState, task: Pick<Task, "needs">, load: (name: string) => "free" | "busy" | "overloaded"): { name: string; level: "free" | "busy" | "overloaded" }[] {
  const order = { free: 0, busy: 1, overloaded: 2 };
  return [...state.members.values()]
    .filter((m) => m.active && !isPerson(m) && !missingNeeds(m, task.needs).length)
    .map((m) => ({ name: m.name, level: load(m.name) }))
    .sort((a, b) => order[a.level] - order[b.level] || a.name.localeCompare(b.name));
}
