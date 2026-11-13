import type { Channel } from "~/model"

const PAIRS = [
  ["atlas", "win"],
  ["pixel", "ridge"],
  ["lena", "nova"],
  ["orbit", "flint"],
] as const

export function withTheirs(c: Channel): Channel {
  const now = Date.now()
  return { ...c, theirs: PAIRS.map((between, i) => ({ between, last: now - (i + 1) * 60_000 })) }
}
