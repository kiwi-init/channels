import type { Message } from "~/model"

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!isRecord(a) || !isRecord(b) || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => k in b && same(a[k], b[k]))
}

export function keepSame(prev: Message[], next: Message[]): Message[] {
  if (!prev.length) return next
  const old = new Map(prev.map((m) => [m.seq, m]))
  let changed = prev.length !== next.length
  const out = next.map((m, i) => {
    const was = old.get(m.seq)
    const kept = was && same(was, m) ? was : m
    if (kept !== prev[i]) changed = true
    return kept
  })
  return changed ? out : prev
}

const last = new Map<string, Message[]>()

export function kept(code: string, next: Message[]): Message[] {
  const out = keepSame(last.get(code) ?? [], next)
  last.set(code, out)
  return out
}
