// Linking a computer to your account (kiwi setup prints a #link=<key> page),
// and the list of your linked computers.

import { RelayError } from "@mc/client.ts"

/** `#link=<computer key>`: the page `kiwi setup` opens to link that computer. */
export function parseLinkHash(hash: string): string | null {
  const m = /^#link=([A-Za-z0-9_-]{20,})$/.exec(hash)
  return m ? m[1]! : null
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

// ---------- computers this browser trusts to vouch on their own ----------
//
// A computer is trusted here once its person compared its code in this browser: when linking it, or
// later from Your computers. Only then may a channel this person owns let that computer's agents in
// without a code check (autoAdmissible): the computer's signature on the agent's key is the proof
// the code check gives, and the relay can't forge it. The list is per browser and per person.

const TRUST_KEY = (user: string) => `mc.trusted-computers.${user}`
const AUTO_KEY = (user: string) => `mc.auto-admit.${user}`

function read<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T | null) ?? fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked (a private window): nothing is remembered, so every agent shows its code as before.
  }
}

/** The keys of the computers this browser trusts, for this person. */
export function trustedComputers(user: string): Set<string> {
  const list = read<unknown>(TRUST_KEY(user), [])
  return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [])
}

export function trustComputer(user: string, pk: string): void {
  write(TRUST_KEY(user), [...trustedComputers(user).add(pk)])
}

export function untrustComputer(user: string, pk: string): void {
  const s = trustedComputers(user)
  s.delete(pk)
  write(TRUST_KEY(user), [...s])
}

/** Whether this person lets their trusted computers' agents into their channels on their own. On unless turned off. */
export function autoAdmitOn(user: string): boolean {
  return read<boolean>(AUTO_KEY(user), true) !== false
}

export function setAutoAdmit(user: string, on: boolean): void {
  write(AUTO_KEY(user), on)
}
