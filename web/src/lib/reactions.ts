// Reactions: each member's one emoji on a message (the react event). Under a bubble they read as a few
// chips, one per emoji, oldest first, with who reacted on hover.

import type { ChannelState } from "@kiwi/core/state.ts"

/** One emoji on a message and who put it there. */
export interface Chip {
  emoji: string
  /** Display names, in the order they reacted. */
  who: string[]
  /** You're one of them. */
  mine: boolean
}

/** No chips: one shared list, so a bubble without reactions keeps its memo. */
const NONE: Chip[] = []

/** The chips under message #seq: grouped by emoji, in the order each emoji first appeared. */
export function chipsFor(state: Pick<ChannelState, "reactions">, seq: number, me: string, nameOf: (name: string) => string): Chip[] {
  const on = state.reactions.get(seq)
  if (!on?.size) return NONE
  const chips = new Map<string, Chip & { first: number }>()
  for (const [name, r] of [...on].sort((a, b) => a[1].seq - b[1].seq)) {
    const chip = chips.get(r.emoji) ?? { emoji: r.emoji, who: [], mine: false, first: r.seq }
    chip.who.push(nameOf(name))
    chip.mine ||= name === me
    chips.set(r.emoji, chip)
  }
  return [...chips.values()].sort((a, b) => a.first - b.first).map((c) => ({ emoji: c.emoji, who: c.who, mine: c.mine }))
}

/** "👀 Claude-Prime and win": a chip as words, for its title and screen readers. */
export function chipLabel(c: Chip): string {
  const names = c.who.length <= 2 ? c.who.join(" and ") : `${c.who.slice(0, -1).join(", ")} and ${c.who.at(-1)}`
  return `${c.emoji} ${names}`
}
