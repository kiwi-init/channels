// The member list: owner-signed records binding each name to a key.
//
// A record is signed by the owner and sealed with the channel key before it
// reaches the relay, so the relay can enforce *who* may connect (by key)
// without learning *what they're called*. Clients verify every record against
// the owner key pinned in the join code, so neither the relay nor a member
// can mint a name: "win" is whoever the owner approved as "win", full stop.

import { openWith, sealWith } from "./crypto.ts";
import { sign, verify, type Identity } from "./identity.ts";
import { isColor, type Color } from "./protocol.ts";
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
   * People and agents are different kinds of member. Absent means agent (CLI-run channels). A
   * "computer" is a person's linked computer, seated quietly so it can let its own agents in (admits).
   */
  kind?: "human" | "agent" | "computer";
  /** A person's full name from sign-in. */
  display?: string;
  /** For an agent: the person it acts for. For a person: themself. */
  sponsor?: Sponsor;
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
  /** In a join request only: the requester means to take over the seat under this name with a new key. */
  reclaim?: boolean;
  /**
   * A computer's seat: since when, and until when, it may let its own agents in. The owner renews
   * `until`; `since` stays the day it was first seated, so renewing keeps the agents it let in.
   */
  admits?: { since: number; until: number };
  /** An agent a computer let in: that computer's key. Kept when the owner re-signs the record, so revoking the computer finds it. */
  via?: string;
}

/** The member a request's name already belongs to: approving it would move their seat to the new key. */
export interface ReclaimTarget {
  name: string;
  pk: string;
  kind?: "human" | "agent" | "computer";
  owner: boolean;
  sponsor?: Sponsor;
}

/** "jonatas" from "Jonatas Walker" or "jonatas@x.com": a channel handle for a signed-in person. */
export function handleFor(name: string, email?: string): string {
  // The whole name, not just the first: "Jonatas Filho" and "Jonatas Walker" must not both be @jonatas.
  const base = (name.trim() || email?.split("@")[0] || "person").toLowerCase().replace(/\s+/g, "-");
  const h = base.normalize("NFKD").replace(/[^\p{L}\p{N}_.-]/gu, "").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
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
  /** Who signed this record, when it wasn't the owner: the computer that let this agent in (see admitRoster). */
  signedBy?: string;
  /** For an agent a computer let in: that computer's name here ("mac-mini"). */
  viaName?: string;
}

export const NAME_RE = /^[\p{L}\p{N}_.\-]{1,32}$/u;

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
    ...(m.color && (m.kind === "human" || m.owner) ? { color: m.color } : {}),
    ...(!m.owner && wireScopes(m.scopes) ? { scopes: wireScopes(m.scopes)! } : {}),
    ...(!m.owner && m.later ? { later: { scopes: wireScopes(m.later.scopes), since: m.later.since } } : {}),
    ...(!m.owner && m.laterRole ? { laterRole: m.laterRole } : {}),
    ...(m.kind === "computer" && m.admits ? { admits: { since: m.admits.since, until: m.admits.until } } : {}),
    ...(m.via ? { via: m.via } : {}),
    at: Date.now(),
  });
}

/** What a computer may put in a record it signs for one of its agents, and nothing else. */
const ADMITTED_FIELDS = new Set(["room", "member", "mxpk", "name", "about", "kind", "sponsor", "via", "at", "pk", "sig"]);

/**
 * A linked computer lets one of its own agents in: the record is the computer's signature, not the
 * owner's. It carries only a name, rules and whose agent it is (see admitRoster for what counts).
 */
export async function makeAdmittedRecord(machine: Identity, room: string, m: { pk: string; xpk: string; name: string; about?: string; sponsor?: Sponsor }): Promise<MemberRecord> {
  return sign(machine, {
    room,
    member: m.pk,
    mxpk: m.xpk,
    name: m.name,
    ...(m.about ? { about: m.about } : {}),
    kind: "agent",
    ...(m.sponsor ? { sponsor: m.sponsor } : {}),
    via: machine.pk,
    at: Date.now(),
  });
}

export async function sealRecord(key: string, rec: MemberRecord): Promise<string> {
  return sealWith(key, JSON.stringify(rec), ad(rec.room));
}

/**
 * Open a sealed record and check its signature, whoever signed it (`signer`): for this room and this
 * key. Whether that signer may admit anyone is admitRoster's call; openRecord takes only the owner's.
 */
export async function readRecord(key: string, sealed: string, room: string, pk: string): Promise<{ member: Member; signer: string; fields: string[] } | null> {
  const raw = await openWith(key, sealed, ad(room));
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as MemberRecord;
    if (typeof rec.pk !== "string" || rec.room !== room || rec.member !== pk || !NAME_RE.test(rec.name)) return null;
    if (!(await verify(rec))) return null;
    const owner = !!rec.owner && rec.member === rec.pk;
    // Scopes the record can't be read as are none at all: a garbled grant gives nothing.
    const scopes = owner || rec.scopes === undefined ? undefined : (readScopes(rec.scopes) ?? []);
    const l = (rec as { later?: { scopes?: unknown; since?: unknown } }).later;
    // null is everything; anything unreadable is nothing.
    const later = !owner && l && Number.isInteger(l.since) ? { scopes: l.scopes === null ? [...SCOPES] : (readScopes(l.scopes) ?? []), since: l.since as number } : undefined;
    const laterRole = owner ? undefined : readLaterRole((rec as { laterRole?: unknown }).laterRole);
    const a = (rec as { admits?: { since?: unknown; until?: unknown } }).admits;
    const admits = rec.kind === "computer" && a && Number.isInteger(a.since) && Number.isInteger(a.until) ? { since: a.since as number, until: a.until as number } : undefined;
    const via = typeof rec.via === "string" ? rec.via : undefined;
    return {
      signer: rec.pk,
      fields: Object.keys(rec),
      member: {
        pk: rec.member,
        xpk: rec.mxpk,
        name: rec.name,
        role: rec.role,
        about: rec.about,
        kind: rec.kind,
        display: rec.display,
        sponsor: rec.sponsor,
        ...(isColor(rec.color) ? { color: rec.color } : {}),
        ...(scopes ? { scopes } : {}),
        ...(later ? { later } : {}),
        ...(laterRole ? { laterRole } : {}),
        ...(admits ? { admits } : {}),
        ...(via ? { via } : {}),
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
  const r = await readRecord(key, sealed, room, pk);
  return r && r.signer === ownerPk ? r.member : null;
}

/** A record as read, with what the relay says about its key: still in, and in the order it was let in. */
export interface ReadEntry {
  read: { member: Member; signer: string; fields: string[] } | null;
  active: boolean;
}

/**
 * Which records count: every one the owner signed, and one a computer signed only when all of this holds.
 * - The computer has a seat the owner signed (kind computer, admits), still in, and not past its `until`.
 * - The record is dated within the seat's time, says `via` that computer, and is an agent's.
 * - It carries nothing but a name, rules and the owner's own person as sponsor: no role, scopes, colour,
 *   or anything else only the owner may grant.
 * - Its name isn't reserved, and no member let in earlier (in the relay's order) holds it.
 * Anything else a computer signed is dropped, as if the relay had never listed it. Entries come in the
 * relay's order; the result keeps it, with `undefined` for a dropped one.
 */
export function admitRoster(entries: readonly ReadEntry[], ownerPk: string, now = Date.now()): (Member | undefined)[] {
  const byOwner = entries.map((e) => (e.read && e.read.signer === ownerPk ? e.read.member : undefined));
  const ownerSponsor = byOwner.find((m) => m?.owner)?.sponsor;
  const seats = new Map<string, Member>();
  entries.forEach((e, i) => {
    const m = byOwner[i];
    if (m && e.active && m.kind === "computer" && m.admits && m.admits.until >= now) seats.set(m.pk, m);
  });
  const held = new Set<string>();
  return entries.map((e, i) => {
    const own = byOwner[i];
    if (own) {
      if (e.active) held.add(nameKey(own.name));
      return own;
    }
    const r = e.read;
    if (!r) return undefined;
    const seat = seats.get(r.signer);
    const m = r.member;
    const ok =
      !!seat &&
      !!seat.admits &&
      m.via === r.signer &&
      m.kind === "agent" &&
      m.at >= seat.admits.since &&
      m.at <= seat.admits.until &&
      r.fields.every((f) => ADMITTED_FIELDS.has(f)) &&
      !RESERVED_NAMES.has(nameKey(m.name)) &&
      (m.sponsor?.user ?? null) === (ownerSponsor?.user ?? null) &&
      !(e.active && held.has(nameKey(m.name)));
    if (!ok) return undefined;
    if (e.active) held.add(nameKey(m.name));
    return { ...m, signedBy: r.signer, viaName: seat!.display ?? seat!.name };
  });
}

/**
 * A name for an agent nobody holds: `base`, else base-2, base-3… Taken is every current member's name
 * and, so nobody new reads as someone who just left, every name that left in the last 30 days.
 */
export function freeAgentName(base: string, members: readonly Pick<Member, "name" | "active" | "at">[], now = Date.now()): string {
  const recent = now - 30 * 86_400_000;
  const taken = new Set(members.filter((m) => m.active || m.at >= recent).map((m) => nameKey(m.name)));
  const stem = base.slice(0, 29);
  if (!taken.has(nameKey(base)) && !RESERVED_NAMES.has(nameKey(base))) return base;
  for (let n = 2; ; n++) if (!taken.has(nameKey(`${stem}-${n}`))) return `${stem}-${n}`;
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
  /** The signed-in person it acts for: themself for a person, or whose linked computer an agent joined from. */
  sponsoredBy: { user: string; name: string; email?: string | null } | null;
  /**
   * Set when the name already belongs to a current member: this is a RECLAIM of
   * their seat, never a plain join. Its code check is never signed automatically.
   */
  reclaims?: ReclaimTarget;
  /** The requester said it means to reclaim (--reclaim); `reclaims` is what counts. */
  reclaim?: boolean;
  /**
   * The key of the computer that vouched for this agent, when its signature (over this channel and
   * this agent's key, sealed to the owner) checks out. The relay can't forge it.
   */
  vouchedBy?: string;
}

/** How a member reads in lists: "win · key QRskRn4Z · agent of @jonatas" / "Jonatas Walker (@jonatas)". */
export function describeMember(m: { name: string; pk: string; kind?: string; display?: string; sponsor?: Sponsor; owner?: boolean; viaName?: string }): string {
  const key = `key ${m.pk.slice(0, 8)}`;
  if (m.kind === "human") return `${m.display ?? m.name} (@${m.name})${m.owner ? " · owner" : ""} · ${key}`;
  if (m.kind === "computer") return `${m.display ?? m.name} (a linked computer) · ${key}`;
  const sponsor = m.sponsor ? ` · agent of @${m.sponsor.handle ?? handleFor(m.sponsor.name)}` : "";
  return `${m.name} · ${key}${sponsor}${m.viaName ? ` · via ${inlineText(m.viaName, 40)}` : ""}`;
}
