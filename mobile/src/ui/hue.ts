import type { Color } from "@mc/protocol.ts"
import { PALETTE } from "@web/lib/characters"

const HUES = (Object.keys(PALETTE) as Color[]).filter((one) => one !== "yellow")

export function hueOf(name: string): Color {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return HUES[h % HUES.length]!
}
