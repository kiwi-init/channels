import { STORAGE, type StorageOp } from "~/mods/protocol"

const DATA = "kiwi-mod-data:"

export type Store = Pick<Storage, "getItem" | "setItem">

function dataOf(store: Store, name: string): Map<string, string> {
  try {
    const raw = JSON.parse(store.getItem(DATA + name) ?? "{}") as unknown
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Map()
    return new Map(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"))
  } catch {
    // What the page can't read or parse starts the mod's storage empty.
    return new Map()
  }
}

export function keep(store: Store, name: string, op: StorageOp, key: string | null, value: string | null): string | string[] | null {
  const data = dataOf(store, name)
  if (op === "keys") return [...data.keys()]
  if (key === null) return null
  if (op === "get") return data.get(key) ?? null
  if (op === "remove") data.delete(key)
  else if (value !== null) data.set(key, value)
  const json = JSON.stringify(Object.fromEntries(data))
  if (json.length > STORAGE.total) throw new Error(`${name} keeps at most ${STORAGE.total.toLocaleString("en")} characters`)
  store.setItem(DATA + name, json)
  return null
}
