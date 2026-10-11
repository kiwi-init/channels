// Linking a computer to your account (kiwi setup prints a #link=<key> page),
// the list of your linked computers, and their seats in the channels you own.

import { Channel, RelayError, type HumanSession } from "@mc/client.ts"
import { verifyText } from "@mc/identity.ts"
import { xpkStatement } from "@mc/vouch.ts"
import { allMembers, saveMember } from "./channel"

/** What `#link=` carries: the computer's key, and (from kiwi 0.9.1) its exchange key with its signature over it. */
export interface ParsedLink {
  pk: string
  xpk?: string
  sig?: string
}

/** `#link=<computer key>[&x=<exchange key>&s=<signature>]`: the page `kiwi setup` opens to link that computer. */
export function parseLinkHash(hash: string): ParsedLink | null {
  const m = /^#link=([A-Za-z0-9_-]{20,})(?:&x=([A-Za-z0-9_-]{20,})&s=([A-Za-z0-9_-]{20,}))?$/.exec(hash)
  return m ? { pk: m[1]!, ...(m[2] && m[3] ? { xpk: m[2], sig: m[3] } : {}) } : null
}

async function call<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (init.token) headers["x-human-token"] = init.token
  const res = await fetch(path, { ...init, headers })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; tag?: string }
  // A RelayError, so callers (and the sign-in check) branch on its tag, not its words.
  if (!res.ok) throw new RelayError(res.status, json.error ?? `the relay returned ${res.status}`, json.tag)
  return json
}

/** What the computer asked to be called, and whether it's linked already. */
export const computerInfo = (pk: string) => call<{ label: string; status: "pending" | "linked"; created: number }>(`/v1/machines/${pk}/public`)

export const confirmComputer = (pk: string, token: string) => call<{ status: string; label: string }>(`/v1/machines/${pk}/confirm`, { method: "POST", token, body: "{}" })

export interface Computer {
  pk: string
  label: string
  linked: number
  /** Last time it vouched for an agent or checked its link, to the hour; null if it hasn't since linking. */
  used: number | null
  /** When the relay unlinks it if it stays unused. */
  expires: number
}

export const myComputers = (token: string) => call<{ machines: Computer[] }>("/v1/me/machines", { token }).then((r) => r.machines)

export const removeComputer = (pk: string, token: string) => call<unknown>(`/v1/me/machines/${pk}`, { method: "DELETE", token })

// ---------- seats: your computers letting their own agents in ----------
//
// Once its person compares a computer's code here, every channel they own gives that computer a quiet
// seat (Channel.seatComputer): the owner's signature that it may let its own agents in for 90 days,
// renewed while they use the channel. Agents started there then join with no request and no code.
// Which computers to seat comes only from what the owner signed: a seat in a channel they own, or the
// link just confirmed here. Never from the relay's list, which a relay could pad with a key of its own.

/** A computer as a seat needs it: its key, its exchange key (signed by that key), and its name. */
export interface SeatableComputer {
  pk: string
  xpk: string
  label: string
}

/** The channels this browser owns, opened as their owner. */
function owned(human: HumanSession): Channel[] {
  return allMembers()
    .filter((m) => m.identity.pk === m.access.ownerPk)
    .map((m) => new Channel(m.access, location.origin, m.identity, (access) => saveMember({ ...m, access }), human))
}

/** Every computer already seated in a channel this browser owns: the owner signed each of those seats. */
export async function seatedComputers(human: HumanSession): Promise<SeatableComputer[]> {
  const out = new Map<string, SeatableComputer>()
  for (const ch of owned(human)) {
    const members = await ch.members().catch(() => [])
    for (const m of members) if (m.active && m.kind === "computer" && !out.has(m.pk)) out.set(m.pk, { pk: m.pk, xpk: m.xpk, label: m.display ?? m.name })
  }
  return [...out.values()]
}

/** Seat one computer in every channel this browser owns. How many it's now seated in. */
export async function seatEverywhere(c: SeatableComputer, human: HumanSession): Promise<number> {
  let n = 0
  for (const ch of owned(human)) {
    await ch.seatComputer(c).then(() => n++, () => undefined)
  }
  return n
}

/** Take a computer's seat away in every channel this browser owns, and remove the agents it let in. */
export async function revokeEverywhere(pk: string, human: HumanSession): Promise<string[]> {
  const removed: string[] = []
  for (const ch of owned(human)) removed.push(...(await ch.revokeComputer(pk).catch(() => [])))
  return removed
}

/** The exchange key in a link, if the computer's own key signed it. */
export async function linkedXpk(link: ParsedLink): Promise<string | null> {
  if (!link.xpk || !link.sig) return null
  return (await verifyText(link.pk, link.sig, xpkStatement(link.pk, link.xpk)).catch(() => false)) ? link.xpk : null
}
