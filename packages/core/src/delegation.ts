import { sign, verify, type Identity } from "./identity.ts";
import type { Member } from "./membership.ts";

const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;
export const DELEGATION_DAYS = 14;
const RENEW_DAYS = 7;
const SKEW_MS = 600_000;
const FIELDS = "at,delegate,dxpk,kind,person,pk,room,scope,sig,until,v";
const RECORD_FIELDS = new Set(["room", "member", "mxpk", "name", "kind", "display", "sponsor", "from", "scopes", "at", "pk", "sig"]);

export interface Delegation {
  kind: "kiwi-delegation";
  v: 1;
  room: string;
  delegate: string;
  dxpk: string;
  person: string;
  scope: "own-agents";
  at: number;
  until: number;
  pk: string;
  sig: string;
}

export function makeDelegation(owner: Identity, room: string, delegate: { pk: string; xpk: string }, person: string, at = Date.now()): Promise<Delegation> {
  return sign(owner, {
    kind: "kiwi-delegation" as const,
    v: 1 as const,
    room,
    delegate: delegate.pk,
    dxpk: delegate.xpk,
    person,
    scope: "own-agents" as const,
    at,
    until: at + DELEGATION_DAYS * DAY_MS,
  });
}

export async function readDelegation(x: unknown, room: string, ownerPk: string): Promise<Delegation | null> {
  let d: unknown = x;
  if (typeof x === "string") {
    try {
      d = JSON.parse(x);
    } catch {
      // Text that isn't JSON is no delegation.
      return null;
    }
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const o = d as Partial<Delegation>;
  if (Object.keys(o).sort().join(",") !== FIELDS) return null;
  if (o.kind !== "kiwi-delegation" || o.v !== 1 || o.scope !== "own-agents" || o.room !== room || o.pk !== ownerPk) return null;
  if (![o.delegate, o.dxpk, o.person].every((k) => typeof k === "string" && KEY_RE.test(k))) return null;
  if (!Number.isSafeInteger(o.at) || !Number.isSafeInteger(o.until) || o.until! <= o.at! || o.until! - o.at! > DELEGATION_DAYS * DAY_MS) return null;
  if (o.delegate === ownerPk) return null;
  return (await verify(o)) ? (o as Delegation) : null;
}

export function delegationLive(d: Delegation, now = Date.now()): boolean {
  return d.at - SKEW_MS <= now && now < d.until;
}

export const delegationDue = (d: Delegation, now = Date.now()): boolean => d.until - now < RENEW_DAYS * DAY_MS;

export function delegatedMember(read: { member: Member; signer: string; fields: readonly string[] }, d: Delegation): boolean {
  const m = read.member;
  return (
    read.signer === d.delegate &&
    read.fields.every((f) => RECORD_FIELDS.has(f)) &&
    m.kind === "agent" &&
    !m.owner &&
    m.from?.pk === d.delegate &&
    m.sponsor?.user === d.person &&
    d.at - SKEW_MS <= m.at &&
    m.at < d.until
  );
}

export const delegateStatement = (room: string, memberPk: string, dpk: string, dbox: string): string => `kiwi-delegate-box\n${room}\n${memberPk}\n${dpk}\n${dbox}`;
