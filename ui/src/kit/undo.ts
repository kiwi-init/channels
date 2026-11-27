import { mod, onMac } from "~/kit/keys"
import { edited, fresh, redone, settled, synced, undone, type History, type Snap } from "~/kit/undo-history"

type Box = HTMLTextAreaElement | HTMLInputElement

const TEXT_TYPES = new Set(["text", "search", "url", "email", "tel"])

function undoable(el: EventTarget | null): el is Box {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  return el instanceof HTMLInputElement && TEXT_TYPES.has(el.type) && !el.readOnly && !el.disabled
}

const histories = new WeakMap<Box, Map<string, History>>()
const composing = new WeakSet<Box>()
let writing = false

const draftOf = (el: Box): string => el.dataset.undo ?? ""

const snap = (el: Box): Snap => ({ value: el.value, start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length })

function read(el: Box): History {
  const kept = histories.get(el)?.get(draftOf(el))
  return kept ? synced(kept, snap(el)) : fresh(snap(el))
}

function keep(el: Box, h: History): void {
  const byDraft = histories.get(el) ?? new Map<string, History>()
  byDraft.set(draftOf(el), h)
  histories.set(el, byDraft)
}

function write(el: Box, to: Snap, type: "historyUndo" | "historyRedo"): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, to.value)
  el.setSelectionRange(to.start, to.end)
  writing = true
  try {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: type }))
  } finally {
    writing = false
  }
}

function step(el: Box, back: boolean): void {
  const h = read(el)
  const moved = back ? undone(h) : redone(h)
  keep(el, moved?.history ?? h)
  if (moved) write(el, moved.to, back ? "historyUndo" : "historyRedo")
}

type Keyed = Pick<KeyboardEvent, "key" | "code" | "altKey" | "shiftKey" | "ctrlKey" | "metaKey" | "isComposing">

const letter = (e: Keyed, key: string): boolean => {
  const typed = e.key.toLowerCase()
  return typed === key || (!/^[a-z]$/.test(typed) && e.code === `Key${key.toUpperCase()}`)
}

export function historyKey(e: Keyed, mac: boolean = onMac()): "undo" | "redo" | null {
  if (e.altKey || e.isComposing) return null
  if (mod(e, mac) && letter(e, "z")) return e.shiftKey ? "redo" : "undo"
  if (!mac && e.ctrlKey && !e.metaKey && !e.shiftKey && letter(e, "y")) return "redo"
  return null
}

export function watchUndo(root: Document = document): () => void {
  const keydown = (e: KeyboardEvent) => {
    const el = e.target
    if (!undoable(el) || composing.has(el)) return
    const which = historyKey(e)
    if (!which) return
    e.preventDefault()
    step(el, which === "undo")
  }
  const beforeinput = (e: InputEvent) => {
    const el = e.target
    if (!undoable(el) || composing.has(el) || e.isComposing) return
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
      e.preventDefault()
      step(el, e.inputType === "historyUndo")
      return
    }
    keep(el, edited(read(el), { type: e.inputType, data: e.data, at: Date.now() }))
  }
  const input = (e: Event) => {
    const el = e.target
    if (writing || !undoable(el) || composing.has(el)) return
    const kept = histories.get(el)?.get(draftOf(el))
    if (kept) keep(el, settled(kept, snap(el)))
  }
  const started = (e: CompositionEvent) => {
    const el = e.target
    if (!undoable(el)) return
    keep(el, edited(read(el), { type: "insertCompositionText", data: null, at: Date.now() }))
    composing.add(el)
  }
  const ended = (e: CompositionEvent) => {
    const el = e.target
    if (!undoable(el)) return
    composing.delete(el)
    setTimeout(() => {
      const kept = histories.get(el)?.get(draftOf(el))
      if (kept) keep(el, settled(kept, snap(el)))
    })
  }
  root.addEventListener("keydown", keydown, true)
  root.addEventListener("beforeinput", beforeinput, true)
  root.addEventListener("input", input, true)
  root.addEventListener("compositionstart", started, true)
  root.addEventListener("compositionend", ended, true)
  return () => {
    root.removeEventListener("keydown", keydown, true)
    root.removeEventListener("beforeinput", beforeinput, true)
    root.removeEventListener("input", input, true)
    root.removeEventListener("compositionstart", started, true)
    root.removeEventListener("compositionend", ended, true)
  }
}
