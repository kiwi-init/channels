// The member list: owner-signed records binding each name to a key.
//
// A record is signed by the owner and sealed with the channel key before it
// reaches the relay, so the relay can enforce *who* may connect (by key)
// without learning *what they're called*. Clients verify every record against
// the owner key pinned in the join code, so neither the relay nor a member
// can mint a name: "win" is whoever the owner approved as "win", full stop.

import type { Pin } from "./pin.ts";
import { cleanPersona, type Persona } from "./personality.ts";
import { openWith, sealWith } from "./crypto.ts";
import { sign, verify, type Identity } from "./identity.ts";
import { checkDevice, type DeviceClaim, type DeviceList } from "./devices.ts";
import { checkComputer, checkPerson, type ComputerClaim, type PersonClaim } from "./person.ts";
import { isColor, type Card, type Color } from "./protocol.ts";
import { readScopes, SCOPES, wireScopes, type Scope } from "./scopes.ts";

/** The signed-in person an agent acts for, as the relay verified them with WorkOS. */
export interface Sponsor {
  /** WorkOS user id. */
  user: string;
  /** Their name as WorkOS knows it ("Jonatas Walker"). */
  name: string;
  /** Their handle in this channel, when they're a member too ("jonatas"). */
  handle?: string;
}

export interface MemberInfo {
  /** Handle in the channel: what messages show and what --to uses. */
  name: string;
  role?: string;
  about?: string;
  /**
   * People and agents are different kinds of member. Absent means agent (CLI-run channels).
   */
  kind?: "human" | "agent";
  display?: string;
  /** For an agent: the person it acts for. For a person: themself. */
  sponsor?: Sponsor;
  /**
   * A person key, for people: signed into the record only from a valid PersonClaim in their join
   * request (the owner's own record carries theirs, from channel creation). Lets the owner's
   * client recognise that person's computers later.
   */
  person?: string;
  addsAgents?: boolean;
  answersDecisions?: boolean;
  managesAgents?: boolean;
  /**
   * On an agent let in with a computer claim: the computer it runs on, so the app can list and
   * remove a computer's agents.
   */
  from?: { pk: string; label: string };
  device?: { pk?: string; label: string; as: "desktop" | "phone" | "computer" };
  /** A person's colour, if the owner set one when admitting them (later changes are color.set events). */
  color?: Color;
  /** What they may do besides read, as the owner signed it at approval. Absent: everything (see scopes.ts). */
  scopes?: Scope[];
  /**
   * What they may do from log position `since` on, after the owner changed it (re-signed with every
   * change). A client that loads only the tail of the log still knows it; the scope.set at `since`
   * says the same thing to one that loads it all.
   */
  later?: { scopes: Scope[]; since: number };
  /**
   * The role (and rules) from log position `since` on, after the owner set it with role.set (re-signed
   * with every change), for a client that loads only the tail of the log. `about` absent: unchanged.
   */
  laterRole?: { role: string | null; about?: string | null; since: number };
  /** In a join request from an older client: it meant to take over the seat under this name. Ignored: seats don't move to new keys. */
  reclaim?: boolean;
  /**
   * In a join request only: the agent didn't pick its name (kiwi join without --as), so a taken
   * one means "give me a free one like it", never a RECLAIM of that seat.
   */
  auto?: boolean;
  /**
   * What runs this agent: the harness and the model id, as the agent declared them when it asked to
   * join and the owner signed them at approval. Only the owner's signature puts it in a record, so a
   * seat's `runs` is the owner's word on what sits behind the key, not the agent's. An agent's later
   * card may say another model; the record keeps what was approved.
   */
  runs?: Runs;
  persona?: Persona;
}

export type PersonPowers = Pick<MemberInfo, "addsAgents" | "answersDecisions" | "managesAgents">;

/** What runs an agent: its harness (claude-code, codex, opencode…) and the model id it answers with. */
export interface Runs {
  harness: string;
  model: string;
}

/** `runs` as something sent or stored says it, if it reads as one: two short non-empty lines. */
export function readRuns(x: unknown): Runs | undefined {
  if (!x || typeof x !== "object") return undefined;
  const r = x as { harness?: unknown; model?: unknown };
  const harness = inlineText(r.harness, 40);
  const model = inlineText(r.model, 60);
  return harness && model ? { harness, model } : undefined;
}

/** "claude-code · claude-fable-5-1": what runs an agent, in one line. */
export function runsLine(r: Runs | undefined): string {
  return r ? `${r.harness} · ${r.model}` : "";
}

/** "jonatas" from "Jonatas Walker" or "jonatas@x.com": a channel handle for a signed-in person. */
export function handleFor(name: string, email?: string): string {
  // The whole name, not just the first: "Jonatas Filho" and "Jonatas Walker" must not both be @jonatas.
  const base = (name.trim() || email?.split("@")[0] || "person").toLowerCase().replace(/\s+/g, "-");
  const h = base
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}_.-]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return h || "person";
}

/** What the owner signs when admitting a key. */
export interface MemberRecord extends Omit<MemberInfo, "later"> {
  /** On the wire, null scopes are everything (see wireScopes). */
  later?: { scopes: Scope[] | null; since: number };
  room: string;
  /** The member's Ed25519 key (`pk` itself is the signer's, i.e. the owner's). */
  member: string;
  /** The member's X25519 key. */
  mxpk: string;
  owner?: boolean;
  at: number;
  pk: string;
  sig: string;
}

export interface Member extends MemberInfo {
  pk: string;
  xpk: string;
  owner: boolean;
  at: number;
  /** False once they've left or been removed. */
  active: boolean;
  /** The relay lists this key as a member, but there's no record the owner signed for it. */
  unverified?: boolean;
  /** The relay refuses this key's posts (the one bit of member scopes it enforces). */
  readOnly?: boolean;
  /**
   * Who signed this record, when it wasn't the owner. Seats are gone in 0.11, so no new record
   * carries one: kept so older readers still compile.
   *
   * @deprecated
   */
  signedBy?: string;
}

export const NAME_RE = /^[\p{L}\p{N}_.-]{1,32}$/u;

/** Names nobody may be admitted under: they'd read as someone or something else. */
export const RESERVED_NAMES = new Set(["human", "owner", "you", "me", "all", "everyone", "system", "kiwi", "admin"]);

/** How names compare: two names that look the same are the same. */
export function nameKey(n: string): string {
  return n.normalize("NFKC").toLowerCase();
}

/**
 * Text someone else wrote, made safe for one line of agent-facing output: no
 * control or direction characters, no line breaks (so it can't pose as another
 * message), bounded length.
 */
export function inlineText(s: unknown, max = 120): string {
  if (typeof s !== "string") return "";
  const flat = s
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

const ad = (room: string) => `mc-member\n${room}`;

export async function makeRecord(owner: Identity, room: string, m: MemberInfo & { pk: string; xpk: string; owner?: boolean }): Promise<MemberRecord> {
  return sign(owner, {
    room,
    member: m.pk,
    mxpk: m.xpk,
    name: m.name,
    ...(m.role ? { role: m.role } : {}),
    ...(m.about ? { about: m.about } : {}),
    ...(m.owner ? { owner: true } : {}),
    ...(m.kind ? { kind: m.kind } : {}),
    ...(m.display ? { display: m.display } : {}),
    ...(m.sponsor ? { sponsor: m.sponsor } : {}),
    ...(m.person ? { person: m.person } : {}),
    ...(!m.owner && m.kind === "human" && m.device ? { device: { ...(m.device.pk ? { pk: m.device.pk } : {}), label: m.device.label, as: m.device.as } } : {}),
    ...(!m.owner && m.kind === "human" && m.addsAgents ? { addsAgents: true } : {}),
    ...(!m.owner && m.kind === "human" && m.answersDecisions ? { answersDecisions: true } : {}),
    ...(!m.owner && m.kind === "human" && m.managesAgents ? { managesAgents: true } : {}),
    ...(m.from ? { from: { pk: m.from.pk, label: m.from.label } } : {}),
    ...(m.color && (m.kind === "human" || m.owner) ? { color: m.color } : {}),
    ...(!m.owner && wireScopes(m.scopes) ? { scopes: wireScopes(m.scopes)! } : {}),
    ...(!m.owner && m.later ? { later: { scopes: wireScopes(m.later.scopes), since: m.later.since } } : {}),
    ...(!m.owner && m.laterRole ? { laterRole: m.laterRole } : {}),
    // An agent's only: never the owner's or a person's record.
    ...(!m.owner && m.kind !== "human" && m.runs ? { runs: { harness: m.runs.harness, model: m.runs.model } } : {}),
    ...(!m.owner && m.kind !== "human" && m.persona ? { persona: m.persona } : {}),
    at: Date.now(),
  });
}

export async function sealRecord(key: string, rec: MemberRecord): Promise<string> {
  return sealWith(key, JSON.stringify(rec), ad(rec.room));
}

/**
 * Open a sealed record and check its signature, whoever signed it (`signer`): for this room and this
 * key. Only the owner's signature counts (openRecord); only the owner's own record, signed by the
 * owner, is the owner's: never one that signs itself so.
 */
export async function readRecord(key: string, sealed: string, room: string, pk: string, ownerPk: string): Promise<{ member: Member; signer: string; fields: string[] } | null> {
  const raw = await openWith(key, sealed, ad(room));
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as MemberRecord;
    if (typeof rec.pk !== "string" || rec.room !== room || rec.member !== pk || !NAME_RE.test(rec.name)) return null;
    if (!(await verify(rec))) return null;
    const owner = !!rec.owner && rec.pk === ownerPk && rec.member === ownerPk;
    // Scopes the record can't be read as are none at all: a garbled grant gives nothing.
    const scopes = owner || rec.scopes === undefined ? undefined : (readScopes(rec.scopes) ?? []);
    const l = (rec as { later?: { scopes?: unknown; since?: unknown } }).later;
    // null is everything; anything unreadable is nothing.
    const later = !owner && l && Number.isInteger(l.since) ? { scopes: l.scopes === null ? [...SCOPES] : (readScopes(l.scopes) ?? []), since: l.since as number } : undefined;
    const laterRole = owner ? undefined : readLaterRole((rec as { laterRole?: unknown }).laterRole);
    const kind = rec.kind === "human" ? "human" : rec.kind === "agent" ? "agent" : undefined;
    // What runs it is the owner's to attest, and only for an agent: kept from the owner's record alone.
    const runs = owner || kind === "human" || rec.pk !== ownerPk ? undefined : readRuns((rec as { runs?: unknown }).runs);
    const persona = owner || kind === "human" || rec.pk !== ownerPk ? undefined : (cleanPersona((rec as { persona?: unknown }).persona) ?? undefined);
    const person = typeof rec.person === "string" && rec.person.length <= 64 ? rec.person : undefined;
    const addsAgents = !owner && kind === "human" && rec.pk === ownerPk && (rec as { addsAgents?: unknown }).addsAgents === true;
    const answersDecisions = !owner && kind === "human" && rec.pk === ownerPk && (rec as { answersDecisions?: unknown }).answersDecisions === true;
    const managesAgents = !owner && kind === "human" && rec.pk === ownerPk && (rec as { managesAgents?: unknown }).managesAgents === true;
    const from = readFrom((rec as { from?: unknown }).from);
    const device = !owner && kind === "human" && rec.pk === ownerPk ? readDeviceMark((rec as { device?: unknown }).device) : undefined;
    return {
      signer: rec.pk,
      fields: Object.keys(rec),
      member: {
        pk: rec.member,
        xpk: rec.mxpk,
        name: rec.name,
        role: rec.role,
        about: rec.about,
        kind,
        ...(typeof rec.display === "string" && inlineText(rec.display, 80) ? { display: inlineText(rec.display, 80) } : {}),
        sponsor: rec.sponsor,
        person,
        ...(addsAgents ? { addsAgents } : {}),
        ...(answersDecisions ? { answersDecisions } : {}),
        ...(managesAgents ? { managesAgents } : {}),
        ...(from ? { from } : {}),
        ...(device ? { device } : {}),
        ...(isColor(rec.color) ? { color: rec.color } : {}),
        ...(scopes ? { scopes } : {}),
        ...(later ? { later } : {}),
        ...(laterRole ? { laterRole } : {}),
        ...(runs ? { runs } : {}),
        ...(persona ? { persona } : {}),
        owner,
        at: rec.at,
        active: true,
      },
    };
  } catch {
    return null;
  }
}

/** Open and verify a sealed record: it must be the owner's signature, for this room and this key. */
export async function openRecord(key: string, sealed: string, room: string, ownerPk: string, pk: string): Promise<Member | null> {
  const r = await readRecord(key, sealed, room, pk, ownerPk);
  return r && r.signer === ownerPk ? r.member : null;
}

/**
 * The claims a join request's sealed info may carry: an agent's computer claim, a person's person
 * claim, or neither. Sealed to the owner with the requester's name and role, so the relay can't
 * read, forge or swap them.
 */
export interface JoinClaims {
  computer?: ComputerClaim;
  person?: PersonClaim;
  device?: DeviceClaim;
  /**
   * What the asker says it runs on (its model, harness, machine), shown to the owner as its word:
   * unlike the two claims above, nothing here is checked. Read through cleanCard.
   */
  card?: Card;
  pin?: string;
  launch?: string;
}

const LAUNCH_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function readLaunch(x: unknown): string | undefined {
  return typeof x === "string" && LAUNCH_RE.test(x) ? x : undefined;
}

/** A verified computer claim, as the owner shows the computer: whose it is, and what it's called. */
export async function verifiedComputer(roomId: string, agentPk: string, c: unknown): Promise<{ pk: string; label: string; person: string; personName: string } | null> {
  const cert = await checkComputer(c, roomId, agentPk);
  return cert ? { pk: cert.machine, label: cert.label, person: cert.pk, personName: cert.name } : null;
}

export async function verifiedDevice(
  roomId: string,
  memberPk: string,
  c: unknown,
  newer?: (person: string) => DeviceList | undefined,
): Promise<{ person: string; pk: string; label: string; as: "desktop" | "phone" | "computer" } | null> {
  const got = await checkDevice(c, roomId, memberPk, newer);
  return got ? { person: got.person, pk: got.device.device, label: got.device.label, as: got.device.as } : null;
}

function readDeviceMark(x: unknown): Member["device"] {
  if (!x || typeof x !== "object") return undefined;
  const d = x as { pk?: unknown; label?: unknown; as?: unknown };
  if (typeof d.label !== "string" || d.label.length > 64) return undefined;
  const pk = typeof d.pk === "string" && d.pk.length <= 64 ? { pk: d.pk } : {};
  return d.as === "desktop" || d.as === "phone" || d.as === "computer" ? { ...pk, label: d.label, as: d.as } : undefined;
}

/** The person key in a verified person claim, or null. */
export function verifiedPerson(roomId: string, memberPk: string, c: unknown): Promise<string | null> {
  return checkPerson(c, roomId, memberPk);
}

/** `from` as a record carries it: the computer's key and the label its person gave it. */
function readFrom(x: unknown): { pk: string; label: string } | undefined {
  if (!x || typeof x !== "object") return undefined;
  const f = x as { pk?: unknown; label?: unknown };
  return typeof f.pk === "string" && f.pk.length <= 64 && typeof f.label === "string" && f.label.length <= 64 ? { pk: f.pk, label: f.label } : undefined;
}

/**
 * A name for an agent nobody holds: `base`, else base-2, base-3… Pass every member, active or departed:
 * a name anyone ever held stays taken, so nobody new reads as someone who left.
 */
export function freeAgentName(base: string, members: readonly Pick<Member, "name">[]): string {
  const taken = new Set(members.map((m) => nameKey(m.name)));
  if (!taken.has(nameKey(base)) && !RESERVED_NAMES.has(nameKey(base))) return base;
  // Names are at most 32 characters, suffix included.
  const named = (n: number) => `${base.slice(0, 31 - String(n).length)}-${n}`;
  for (let n = 2; ; n++) if (!taken.has(nameKey(named(n)))) return named(n);
}

/** A record's later role, if it reads as one: a role string (or null for none), rules likewise, and where it took effect. */
function readLaterRole(x: unknown): MemberInfo["laterRole"] {
  if (!x || typeof x !== "object") return undefined;
  const r = x as { role?: unknown; about?: unknown; since?: unknown };
  const okText = (v: unknown, max: number) => v === null || (typeof v === "string" && v.length <= max);
  if (!Number.isInteger(r.since) || !okText(r.role, 200) || (r.about !== undefined && !okText(r.about, 2000))) return undefined;
  return { role: r.role as string | null, ...(r.about !== undefined ? { about: r.about as string | null } : {}), since: r.since as number };
}

/** A pending join request, as the owner sees it after opening its box. */
export interface JoinRequest extends MemberInfo {
  id: string;
  pk: string;
  xpk: string;
  /** The 6-digit code the requester sees too; null until both halves of the check are in. */
  code: string | null;
  /**
   * Where the code check stands: "unchecked" until an owner device signs its half (a click,
   * once a device has signed its day's share on its own), "waiting" for the joiner's half.
   */
  check: "unchecked" | "waiting" | "ready";
  /** The joiner's commitment, which the owner signs. */
  commit: string;
  ts: number;
  /**
   * The relay's word (from sign-in) for who vouches for this request. The relay no longer vouches
   * for anyone in 0.11: always null from new code. Kept so older callers still compile.
   *
   * @deprecated
   */
  sponsoredBy: { user: string; name: string; email?: string | null } | null;
  /**
   * The agent didn't pick its name: this is the name it asked under ("claude"), and `name` is a free
   * one like it ("claude-2"). Approval picks again if that one was taken in the meantime.
   */
  askedAs?: string;
  pin?: Pin;
  /**
   * The computer this agent runs on, when its claim (its person's cert for it, and its signature
   * over this channel and this agent's key) checks out. `person` is the person key that certified
   * it, `personName` the name on that cert, `own` whether that person key is the owner's own
   * (which the owner's client passes in, since only the app holds it), and `joinsOnItsOwn` whether
   * it's let in without a tap: the owner's own, or a person's whose record says they add agents.
   */
  computer?: { pk: string; label: string; person: string; personName: string; own: boolean; joinsOnItsOwn: boolean; forgotten?: true };
  device?: { pk: string; person: string; label: string; as: "desktop" | "phone" | "computer"; own: boolean; joinsOnItsOwn: boolean; handle?: string };
  /**
   * A person asking to join themself: their verified person key (from a valid PersonClaim over this
   * channel and this member key). Approving signs it into their member record.
   */
  person?: string;
  /** What the agent says it runs on (model, harness, machine), unchecked: its word, shown as such. */
  card?: Card;
  launch?: string;
}

/** How a member reads in lists: "win · key QRskRn4Z · agent of @jonatas" / "Jonatas Walker (@jonatas)". */
export function describeMember(m: { name: string; pk: string; kind?: string; display?: string; sponsor?: Sponsor; owner?: boolean }): string {
  const key = `key ${m.pk.slice(0, 8)}`;
  if (m.kind === "human") return `${m.display ?? m.name} (@${m.name})${m.owner ? " · owner" : ""} · ${key}`;
  const sponsor = m.sponsor ? ` · agent of @${m.sponsor.handle ?? handleFor(m.sponsor.name)}` : "";
  return `${m.display ? `${m.display} (@${m.name})` : m.name} · ${key}${sponsor}`;
}
