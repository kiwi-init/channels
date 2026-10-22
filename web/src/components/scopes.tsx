import type { PersonPowers } from "@kiwi/core/membership.ts"
import { presetOf, SCOPES, type Scope } from "@kiwi/core/scopes.ts"
import { Checkbox } from "./kit"

// What a member may do besides read: everything, or nothing but read. The owner signs the choice;
// every client enforces it. A grant from before the two levels (some scopes, not all) keeps working
// as it was, and reads as limited until it's changed.

/** How a member's scopes read in a line: nothing for a member (the usual), else "read only" or "limited". */
export function scopesLine(scopes: readonly Scope[]): string | null {
  const p = presetOf(scopes)
  if (p === "full") return null
  if (p === "read-only") return "read only"
  return "limited (an older setting)"
}

/** One switch: a member, or someone who can only read. */
export function ScopePicker({ value, onChange, disabled }: { value: Scope[]; onChange: (s: Scope[]) => void; disabled?: boolean }) {
  const preset = presetOf(value)
  return (
    <div className="grid gap-1">
      <label className="flex items-center gap-2 text-ui text-ink">
        <Checkbox checked={preset === "read-only"} onChange={(e) => onChange(e.target.checked ? [] : [...SCOPES])} disabled={disabled} />
        Can only read
      </label>
      <p className="text-meta leading-snug text-ink-3">
        {preset === "read-only"
          ? "Reads the channel; can't send anything."
          : preset === "full"
            ? "A member: writes, asks, works on tasks and sets notes."
            : "An older, limited setting. Choosing here replaces it."}
      </p>
    </div>
  )
}

// What new members get by default, picked when inviting and confirmed at each approval. It's this
// browser's preference, not a promise: nothing is signed until the owner approves someone.
const DEFAULT_KEY = (roomId: string) => `mc.scopes.${roomId}`

export function defaultScopes(roomId: string): Scope[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DEFAULT_KEY(roomId)) ?? "null") as unknown
    // Two levels: an empty list is read-only; anything else (an older mix included) is a member.
    return Array.isArray(raw) && raw.length === 0 ? [] : [...SCOPES]
  } catch {
    return [...SCOPES]
  }
}

export function saveDefaultScopes(roomId: string, scopes: Scope[]): void {
  try {
    localStorage.setItem(DEFAULT_KEY(roomId), JSON.stringify(scopes))
  } catch {
    // A full or blocked store just forgets the preference.
  }
}

export const POWERS = ["addsAgents", "answersDecisions"] as const
type Power = (typeof POWERS)[number]

export const POWER_WORDS: Record<Power, { label: string; on: string; off: string }> = {
  addsAgents: {
    label: "Can add agents",
    on: "Their agents join on their own from computers paired with their Kiwi app, while yours is open.",
    off: "Their agents wait for you to let them in.",
  },
  answersDecisions: {
    label: "Can answer decisions",
    on: "They see agents’ decisions in Needs you and answer them, as you do. Permission prompts and browser handoffs stay with you and each agent’s own person.",
    off: "Agents’ decisions go to you and each agent’s own person.",
  },
}

const POWER_KEY = (roomId: string, power: Power) => `mc.${power}.${roomId}`

export function defaultPowers(roomId: string): PersonPowers {
  const on = (power: Power) => {
    try {
      return localStorage.getItem(POWER_KEY(roomId, power)) === "1"
    } catch {
      return false
    }
  }
  return { addsAgents: on("addsAgents"), answersDecisions: on("answersDecisions") }
}

export function saveDefaultPowers(roomId: string, powers: PersonPowers): void {
  try {
    for (const power of POWERS) localStorage.setItem(POWER_KEY(roomId, power), powers[power] ? "1" : "0")
  } catch {
    // A full or blocked store just forgets the preference.
  }
}

export function PowersPicker({ value, onChange, disabled }: { value: PersonPowers; onChange: (powers: PersonPowers) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-3">
      {POWERS.map((power) => (
        <div key={power} className="grid gap-1">
          <label className="flex items-center gap-2 text-ui text-ink">
            <Checkbox checked={!!value[power]} onChange={(e) => onChange({ ...value, [power]: e.target.checked })} disabled={disabled} />
            {POWER_WORDS[power].label}
          </label>
          <p className="text-meta leading-snug text-ink-3">{value[power] ? POWER_WORDS[power].on : POWER_WORDS[power].off}</p>
        </div>
      ))}
    </div>
  )
}
