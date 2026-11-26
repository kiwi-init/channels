import { Words, wordsRaw } from "~/words"

export function rendered(x: unknown): unknown {
  if (x instanceof Words) return { words: wordsRaw(x) }
  if (x instanceof Map) return { map: [...x].map(([k, v]) => [rendered(k), rendered(v)]) }
  if (x instanceof Set) return { set: [...x].map(rendered) }
  if (Array.isArray(x)) return x.map(rendered)
  if (typeof x === "object" && x !== null) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, rendered(v)]))
  return x
}
