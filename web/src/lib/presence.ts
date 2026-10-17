import type { Reach } from "@kiwi/core/protocol.ts"

export type How = "listening" | "running" | "wakes" | "unknown"

export interface Said {
  client: string
  reach?: Reach
  wakes: boolean
}

export function howHere(o: Said | undefined): How | null {
  if (!o) return null
  if (o.reach === "listening" || o.reach === "running") return o.reach
  if (o.wakes) return "wakes"
  if (o.reach === "unreachable") return null
  return o.client === "daemon" ? "unknown" : "listening"
}

export function howWords(how: How): string | null {
  switch (how) {
    case "listening":
      return "Listening"
    case "running":
      return "Running"
    case "wakes":
      return "Wakes on new messages"
    case "unknown":
      return null
  }
}
