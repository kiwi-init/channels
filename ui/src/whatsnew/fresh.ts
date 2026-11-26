const KEY = "mc.whatsnew.from"

type Store = Pick<Storage, "length" | "getItem" | "setItem">

export function installDay(store: () => Store, today: string): string | null {
  try {
    const s = store()
    if (s.length === 0) s.setItem(KEY, today)
    return s.getItem(KEY)
  } catch {
    // No storage to read or write: no install day, so every note counts as new, as before.
    return null
  }
}

export const newerThan = (since: string | null, from: string | null): boolean => from === null || (since !== null && since > from)

export const firstDay = installDay(() => localStorage, new Date().toISOString().slice(0, 10))
