import { docLinesOf, withDocLines, type DocLine, type DocLines } from "@kiwi/channel/kept.ts"

import type { Channel } from "~/model"

const KEY = "kiwi:demo-doc-lines"

function read(): Readonly<Record<string, DocLines>> {
  try {
    const got: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "{}")
    if (typeof got !== "object" || got === null) return {}
    return Object.fromEntries(Object.entries(got).map(([code, lines]: [string, unknown]) => [code, docLinesOf(lines)]))
  } catch {
    // Storage can be off or hold junk: the demo opens with no remembered doc lines.
    return {}
  }
}

let kept = read()

export function withDemoDocLines(channels: Map<string, Channel>): Map<string, Channel> {
  return new Map(
    [...channels].map(([code, c]) => {
      const docLines = kept[code]
      return [code, docLines && Object.keys(docLines).length ? { ...c, docLines } : c]
    })
  )
}

export function keepDemoDocLines(code: string, thread: string, lines: readonly DocLine[]): void {
  const now = kept[code] ?? {}
  const next = withDocLines(now, thread, lines)
  if (next === now) return
  kept = { ...kept, [code]: next }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(kept))
  } catch {
    // Storage can be off or full: the demo's next open waits for the doc's lines, as a first open does.
  }
}
