const KEY = "mc.doc-made"
const MAX = 2000

export interface MadeLines {
  has: (block: string) => boolean
  add: (block: string) => unknown
}

function load(): string[] {
  try {
    const got: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]")
    return Array.isArray(got) ? got.filter((x): x is string => typeof x === "string").slice(-MAX) : []
  } catch {
    // Storage is off or the list is damaged: this app starts with no lines of its own, so it tidies none of the old ones.
    return []
  }
}

let order: string[] | null = null
let ids: Set<string> | null = null

function list(): Set<string> {
  if (!ids) {
    order = load()
    ids = new Set(order)
  }
  return ids
}

export const madeHere: MadeLines = {
  has: (block) => list().has(block),
  add: (block) => {
    const all = list()
    if (all.has(block) || !order) return
    all.add(block)
    order.push(block)
    if (order.length > MAX) for (const gone of order.splice(0, order.length - MAX)) all.delete(gone)
    try {
      localStorage.setItem(KEY, JSON.stringify(order))
    } catch {
      // Storage is off: the line stays this app's until it restarts.
    }
  },
}
