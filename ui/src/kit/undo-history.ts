export interface Snap {
  readonly value: string
  readonly start: number
  readonly end: number
}

type Kind = "insert" | "delete" | "other"

export interface History {
  readonly past: readonly Snap[]
  readonly future: readonly Snap[]
  readonly now: Snap
  readonly kind: Kind | null
  readonly at: number
  readonly spaced: boolean
}

export interface Edit {
  readonly type: string
  readonly data: string | null
  readonly at: number
}

export const PAUSE_MS = 1000
const STEPS = 200

export const fresh = (now: Snap): History => ({ past: [], future: [], now, kind: null, at: 0, spaced: false })

function kindOf(type: string): Kind {
  if (type === "insertText" || type === "insertLineBreak" || type === "insertParagraph") return "insert"
  if (type.startsWith("delete") && type !== "deleteByCut" && type !== "deleteByDrag") return "delete"
  return "other"
}

const typedSpace = (type: string, data: string | null): boolean => type !== "insertText" || /\s$/.test(data ?? "")

export function synced(h: History, current: Snap): History {
  if (current.value === h.now.value) return moved(h, current)
  if (current.value === "") return fresh(current)
  return { ...h, past: [...h.past, h.now].slice(-STEPS), future: [], now: current, kind: null }
}

export function edited(h: History, edit: Edit): History {
  const kind = kindOf(edit.type)
  const wordStarts = kind === "insert" && h.spaced && !typedSpace(edit.type, edit.data)
  const joins = kind !== "other" && h.kind === kind && edit.at - h.at <= PAUSE_MS && !wordStarts
  const spaced = kind === "insert" && typedSpace(edit.type, edit.data)
  return { past: joins ? h.past : [...h.past, h.now].slice(-STEPS), future: [], now: h.now, kind, at: edit.at, spaced }
}

export const settled = (h: History, now: Snap): History => ({ ...h, now })

function moved(h: History, current: Snap): History {
  const still = current.start === h.now.start && current.end === h.now.end
  return still ? h : { ...h, now: current, kind: null }
}

export function undone(h: History): { history: History; to: Snap } | null {
  const to = h.past.at(-1)
  if (!to) return null
  return { history: { ...h, past: h.past.slice(0, -1), future: [...h.future, h.now], now: to, kind: null }, to }
}

export function redone(h: History): { history: History; to: Snap } | null {
  const to = h.future.at(-1)
  if (!to) return null
  return { history: { ...h, past: [...h.past, h.now], future: h.future.slice(0, -1), now: to, kind: null }, to }
}
