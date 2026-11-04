import type { TypingNote } from "~/kit/typing-hook"

export interface TypingEntry extends TypingNote {
  t: number
  key?: string
  inputType?: string
  data?: string
  caret?: number
  flag?: string
}

const MAX = 4000
const DELETE_MS = 150
const TAIL = 3

const isDelete = (e: TypingEntry): boolean =>
  e.key === "Backspace" || e.key === "Delete" || (e.inputType?.startsWith("delete") ?? false) || e.inputType === "historyUndo" || e.inputType === "insertReplacementText"

export const keyName = (key: string): string => ([...key].length === 1 ? "char" : key)

export function dataShape(data: string | null): string | undefined {
  if (data === null) return undefined
  const chars = [...data]
  return `${chars.length} chars, ends "${chars.slice(-TAIL).join("")}"`
}

export class TypingRecord {
  readonly entries: TypingEntry[] = []
  readonly flags: { at: TypingEntry; before: TypingEntry[] }[] = []
  private lens = new Map<string, number>()

  push(e: TypingEntry): void {
    if (this.entries.length >= MAX) this.entries.shift()
    this.entries.push(e)
  }

  seen(t: number, block: string, len: number, caret?: number): void {
    const was = this.lens.get(block)
    this.lens.set(block, len)
    if (was === undefined || len >= was) return
    const recent = this.entries.filter((e) => t - e.t <= DELETE_MS)
    if (recent.some(isDelete)) return
    const at: TypingEntry = { t, what: "dom text shrank", block, before: was, after: len, ...(caret === undefined ? {} : { caret }), flag: "SHRANK WITHOUT A DELETE KEY" }
    this.push(at)
    this.flags.push({ at, before: this.entries.slice(-25, -1) })
  }

  report(about: Record<string, string | number>): string {
    return JSON.stringify({ ...about, entries: this.entries.length, flagged: this.flags.length, flags: this.flags.slice(-10), last: this.entries.slice(-400) }, null, 1)
  }
}
