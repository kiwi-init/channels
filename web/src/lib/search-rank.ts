const IDEOGRAPH = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}"
const WORD = new RegExp(`[${IDEOGRAPH}]|\\p{Extended_Pictographic}|(?:(?![${IDEOGRAPH}])[\\p{L}\\p{N}\\p{M}])+`, "gu")
const MAX_TERMS = 32
const K1 = 1.2
const B = 0.75
const PREFIX = 0.6

type Field = { text: string; weight: number }
export type Doc<T> = { item: T; fields: Field[] }
export type Index<T> = { docs: { item: T; tokens: Map<string, number>; length: number }[]; average: number }
export type Ranked<T> = { item: T; score: number }
export type Segment = { text: string; hit: boolean }

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
const words = (text: string) => [...text.matchAll(WORD)].flatMap((m) => (fold(m[0]) ? [{ word: m[0], folded: fold(m[0]), at: m.index }] : []))

export function terms(query: string): string[] {
  return [...new Set(words(query).map((w) => w.folded))].slice(0, MAX_TERMS)
}

export function buildIndex<T>(docs: Iterable<Doc<T>>): Index<T> {
  const out: Index<T>["docs"] = []
  let total = 0
  for (const { item, fields } of docs) {
    const tokens = new Map<string, number>()
    let length = 0
    for (const { text, weight } of fields)
      for (const { folded } of words(text)) {
        tokens.set(folded, (tokens.get(folded) ?? 0) + weight)
        length += 1
      }
    out.push({ item, tokens, length })
    total += length
  }
  return { docs: out, average: out.length ? total / out.length : 0 }
}

const frequency = (tokens: Map<string, number>, term: string) => {
  let tf = 0
  for (const [word, count] of tokens) {
    if (word === term) tf += count
    else if (word.startsWith(term)) tf += count * PREFIX
  }
  return tf
}

export function rank<T>(index: Index<T>, query: string): Ranked<T>[] {
  const wanted = terms(query)
  if (!wanted.length || !index.docs.length) return []
  const n = index.docs.length
  const scores = Array.from({ length: n }, () => 0)
  const matched = Array.from({ length: n }, () => 0)
  for (const term of wanted) {
    const tfs = index.docs.map((d) => frequency(d.tokens, term))
    const df = tfs.filter((tf) => tf > 0).length
    if (!df) return []
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5))
    tfs.forEach((tf, i) => {
      if (!tf) return
      const norm = K1 * (1 - B + (B * index.docs[i]!.length) / (index.average || 1))
      scores[i]! += (idf * tf * (K1 + 1)) / (tf + norm)
      matched[i]! += 1
    })
  }
  const out: Ranked<T>[] = []
  index.docs.forEach((d, i) => {
    if (matched[i] === wanted.length) out.push({ item: d.item, score: scores[i]! })
  })
  return out.sort((a, b) => b.score - a.score)
}

const longestPrefix = (folded: string, wanted: string[]) => wanted.filter((t) => folded.startsWith(t)).sort((a, b) => b.length - a.length)[0]

const prefixEnd = (word: string, term: string) => {
  let end = 0
  let seen = 0
  for (const ch of word) {
    const width = fold(ch).length
    if (seen >= term.length && width > 0) break
    seen += width
    end += ch.length
  }
  return end
}

export function marks(text: string, wanted: string[]): Segment[] {
  const out: Segment[] = []
  let at = 0
  for (const { word, folded, at: start } of words(text)) {
    const term = longestPrefix(folded, wanted)
    if (!term) continue
    const end = start + prefixEnd(word, term)
    if (start > at) out.push({ text: text.slice(at, start), hit: false })
    out.push({ text: text.slice(start, end), hit: true })
    at = end
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false })
  return out
}

export function snippet(text: string, wanted: string[], room = 60): string {
  const flat = text.replace(/\s+/g, " ").trim()
  const first = words(flat).find((w) => longestPrefix(w.folded, wanted))?.at ?? -1
  if (first <= room) return flat
  const cut = flat.lastIndexOf(" ", first - room / 2)
  return `…${flat.slice(cut < 0 ? first : cut + 1)}`
}
