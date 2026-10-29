import type { Message } from "@kiwi/core/protocol.ts"

import { knownRefs } from "@kiwi/app/markdown.ts"
import type { MessageProps } from "./message"

const BY_VALUE = new Set<keyof MessageProps>(["reactions", "prs", "thread", "chosen", "trust", "settled"])

export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  if (Array.isArray(b)) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x).filter((k) => x[k] !== undefined)
  return keys.length === Object.keys(y).filter((k) => y[k] !== undefined).length && keys.every((k) => sameValue(x[k], y[k]))
}

const sameQuotes = (m: Message, a: MessageProps["quoted"], b: MessageProps["quoted"]): boolean =>
  (m.re ?? []).every((seq) => a(seq) === b(seq)) && (!m.body.includes("#") || knownRefs(m.body, (seq) => a(seq) !== undefined) === knownRefs(m.body, (seq) => b(seq) !== undefined))

export function sameRow(a: MessageProps, b: MessageProps): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof MessageProps)[])
  for (const k of keys) {
    if (k === "onChoose") {
      if (!a.onChoose !== !b.onChoose) return false
    } else if (k === "quoted") {
      if (a.quoted !== b.quoted && !sameQuotes(b.m, a.quoted, b.quoted)) return false
    } else if (BY_VALUE.has(k) ? !sameValue(a[k], b[k]) : !Object.is(a[k], b[k])) return false
  }
  return true
}
