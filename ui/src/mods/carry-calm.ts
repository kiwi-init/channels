const PREFS = "ui.prefs"
const KEPT = [0, 1, 5, 10]

export function carryCalm(store: Pick<Storage, "getItem" | "setItem">): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(store.getItem(PREFS) ?? "{}")
  } catch {
    // Prefs that don't parse hold no Calm choice to carry.
    return null
  }
  if (!raw || typeof raw !== "object" || !("calm" in raw)) return null
  const { calm, ...rest } = raw as Record<string, unknown>
  store.setItem(PREFS, JSON.stringify(rest))
  return typeof calm === "number" && KEPT.includes(calm) ? (calm ? `${calm} min` : "Off") : null
}
