import type { Message } from "@kiwi/core/protocol.ts"

import { knownRefs } from "@/lib/markdown"
import type { MessageProps } from "./message"

const BY_VALUE = new Set<keyof MessageProps>(["reactions", "prs", "thread", "chosen", "trust"])

const sameValue = (a: unknown, b: unknown): boolean => Object.is(a, b) || (typeof a === "object" && typeof b === "object" && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b))

const sameQuotes = (m: Message, a: MessageProps["quoted"], b: MessageProps["quoted"]): boolean =>
  (m.re ?? []).every((seq) => a(seq) === b(seq)) && knownRefs(m.body, (seq) => a(seq) !== undefined) === knownRefs(m.body, (seq) => b(seq) !== undefined)

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
