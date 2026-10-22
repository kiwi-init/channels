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

const AGENTS_KEY = (roomId: string) => `mc.addsAgents.${roomId}`

export function defaultAddsAgents(roomId: string): boolean {
  try {
    return localStorage.getItem(AGENTS_KEY(roomId)) === "1"
  } catch {
    return false
  }
}

export function saveDefaultAddsAgents(roomId: string, on: boolean): void {
  try {
    localStorage.setItem(AGENTS_KEY(roomId), on ? "1" : "0")
  } catch {
    // A full or blocked store just forgets the preference.
  }
}

export function AddsAgentsPicker({ value, onChange, disabled }: { value: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-1">
      <label className="flex items-center gap-2 text-ui text-ink">
        <Checkbox checked={value} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
        Can add agents
      </label>
      <p className="text-meta leading-snug text-ink-3">
        {value ? "Their agents join on their own from computers paired with their Kiwi app, while yours is open." : "Their agents wait for you to let them in."}
      </p>
    </div>
  )
}
