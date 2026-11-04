import { setTypingSink, typingFocus, type TypingNote } from "~/kit/typing-hook"
import { dataShape, keyName, TypingRecord, type TypingEntry } from "~/kit/typing-record"

const TRACE_MS = 60_000

let record = new TypingRecord()
let undo: (() => void) | null = null
let started = 0
let last: { block: string; el: HTMLElement } | null = null

const now = (): number => Math.round(performance.now())

const inDoc = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest(".ProseMirror")

const lenOf = (el: HTMLElement): number => el.querySelector(".blk-body")?.textContent?.length ?? 0

function here(): { block: string; el: HTMLElement; caret: number } | null {
  const s = getSelection()
  const n = s?.anchorNode ?? null
  const el = (n instanceof Element ? n : (n?.parentElement ?? null))?.closest<HTMLElement>(".ProseMirror .blk") ?? null
  const body = el?.querySelector(".blk-body")
  const block = el?.dataset.block
  if (!el || !block || !body || !n) return null
  const r = document.createRange()
  r.setStart(body, 0)
  try {
    r.setEnd(n, s?.anchorOffset ?? 0)
  } catch {
    // The caret sits outside the block's text (its head or foot): its offset isn't known.
    return { block, el, caret: -1 }
  }
  return { block, el, caret: r.toString().length }
}

function look(): void {
  const t = now()
  if (last && !last.el.isConnected) {
    const again = document.querySelector<HTMLElement>(`.ProseMirror .blk[data-block="${CSS.escape(last.block)}"]`)
    if (again) record.push({ t, what: "your line was redrawn", block: last.block })
    else record.push({ t, what: "your line left the page", block: last.block, flag: "LINE REMOVED" })
    last = again ? { block: last.block, el: again } : null
  }
  const h = here()
  if (!h) return
  last = { block: h.block, el: h.el }
  record.seen(t, h.block, lenOf(h.el), h.caret)
}

function withFocus(n: TypingNote): TypingEntry {
  const f = typingFocus()
  if (!f) return { t: now(), ...n }
  const h = here()
  const screen = h?.block === f.block ? { screen: lenOf(h.el) } : {}
  const off = f.editor !== f.stored ? { flag: "EDITOR OUT OF STEP WITH THE DOC" } : {}
  return { t: now(), ...n, block: n.block ?? f.block, ...screen, editor: f.editor, stored: f.stored, ...(n.doc ? { here: n.doc === f.doc } : {}), ...off }
}

function stop(): void {
  undo?.()
  undo = null
}

export function startTypingTrace(): void {
  stop()
  record = new TypingRecord()
  started = Date.now()
  last = null
  const onKey = (e: KeyboardEvent): void => {
    if (!inDoc(e.target)) return
    const h = here()
    record.push({ t: now(), what: "key", key: keyName(e.key), ...(h ? { block: h.block, before: lenOf(h.el), caret: h.caret } : {}) })
  }
  const onBefore = (e: InputEvent): void => {
    if (!inDoc(e.target)) return
    const h = here()
    const data = dataShape(e.data)
    record.push({ t: now(), what: "beforeinput", inputType: e.inputType, ...(data ? { data } : {}), ...(h ? { block: h.block, before: lenOf(h.el), caret: h.caret } : {}) })
  }
  const onInput = (e: Event): void => {
    if (!inDoc(e.target)) return
    const h = here()
    record.push({ t: now(), what: "input", ...(e instanceof InputEvent ? { inputType: e.inputType } : {}), ...(h ? { block: h.block, after: lenOf(h.el), caret: h.caret } : {}) })
    look()
  }
  const watch = new MutationObserver(look)
  watch.observe(document.body, { subtree: true, childList: true, characterData: true })
  const onCompose = (e: CompositionEvent): void => {
    if (inDoc(e.target)) record.push({ t: now(), what: e.type })
  }
  setTypingSink((n) => record.push(withFocus(n)))
  document.addEventListener("keydown", onKey, true)
  document.addEventListener("beforeinput", onBefore, true)
  document.addEventListener("input", onInput, true)
  for (const type of ["compositionstart", "compositionend"] as const) document.addEventListener(type, onCompose, true)
  const timer = window.setTimeout(stop, TRACE_MS)
  undo = () => {
    setTypingSink(null)
    watch.disconnect()
    document.removeEventListener("keydown", onKey, true)
    document.removeEventListener("beforeinput", onBefore, true)
    document.removeEventListener("input", onInput, true)
    for (const type of ["compositionstart", "compositionend"] as const) document.removeEventListener(type, onCompose, true)
    window.clearTimeout(timer)
  }
}

export function typingTrace(): string {
  return record.report({ agent: navigator.userAgent, size: `${innerWidth}x${innerHeight}`, started: new Date(started).toISOString(), recording: undo ? "yes" : "no" })
}
