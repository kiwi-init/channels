const KEY = "mc.doc-made"
const MAX = 2000

export interface MadeLines {
  has: (block: string) => boolean
  add: (block: string) => unknown
}

type MadeStore = Pick<Storage, "getItem" | "setItem">

function load(store: MadeStore | null): string[] {
  try {
    const got: unknown = JSON.parse(store?.getItem(KEY) ?? "[]")
    return Array.isArray(got) ? got.filter((x): x is string => typeof x === "string").slice(-MAX) : []
  } catch {
    // Storage is off or the list is damaged: this window starts with no lines of its own, so it tidies none of the old ones.
    return []
  }
}

function madeLines(store: MadeStore | null): MadeLines {
  const order = load(store)
  const ids = new Set(order)
  return {
    has: (block) => ids.has(block),
    add: (block) => {
      if (ids.has(block)) return
      ids.add(block)
      order.push(block)
      if (order.length > MAX) for (const gone of order.splice(0, order.length - MAX)) ids.delete(gone)
      try {
        store?.setItem(KEY, JSON.stringify(order))
      } catch {
        // Storage is full or off: the line stays this window's until it reloads.
      }
    },
  }
}

function windowStore(): MadeStore | null {
  try {
    return sessionStorage
  } catch {
    // Session storage is blocked: the lines this window makes are remembered until it reloads.
    return null
  }
}

export const madeHere: MadeLines = madeLines(windowStore())
