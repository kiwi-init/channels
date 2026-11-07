import type { ModView } from "../../../desktop/src/bridge.ts"

const PREFS = "ui.prefs"
const KEPT = [0, 1, 5, 10]
const OLD = "calm"

const afkNeeds = (needs: readonly string[]): string[] => needs.map((n) => (n === "idle" ? "afk" : n))

export const afkView = (m: ModView): ModView => ({ ...m, needs: afkNeeds(m.needs), approved: afkNeeds(m.approved) })

export function carryAfk(store: Pick<Storage, "getItem" | "setItem">): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(store.getItem(PREFS) ?? "{}")
  } catch {
    // Prefs that don't parse hold no AFK wait to carry.
    return null
  }
  if (!raw || typeof raw !== "object" || !(OLD in raw)) return null
  const { [OLD]: wait, ...rest } = raw as Record<string, unknown>
  store.setItem(PREFS, JSON.stringify(rest))
  return typeof wait === "number" && KEPT.includes(wait) ? (wait ? `${wait} min` : "Off") : null
}
