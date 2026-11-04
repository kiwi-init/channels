interface Entry {
  t: number
  what: string
  el: string
  top: number
  to: number | null
  height: number
  stack: string
}

const MAX = 3000
const TRACE_MS = 20_000

let entries: Entry[] = []
let stopAt = 0
let undo: (() => void) | null = null
let wrote = false

function nameOf(el: Element): string {
  const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""
  return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`
}

function stackHere(): string {
  return (new Error().stack ?? "")
    .split("\n")
    .slice(3, 10)
    .map((l) => l.trim())
    .join(" | ")
}

function push(what: string, el: Element, to: number | null): void {
  if (performance.now() > stopAt) return stop()
  if (entries.length >= MAX) entries.shift()
  entries.push({ t: Math.round(performance.now()), what, el: nameOf(el), top: Math.round(el.scrollTop), to, height: el.scrollHeight, stack: what === "scroll" ? "" : stackHere() })
}

function stop(): void {
  undo?.()
  undo = null
}

export function tracing(): boolean {
  return undo !== null
}

export function startScrollTrace(): void {
  stop()
  entries = []
  stopAt = performance.now() + TRACE_MS
  const proto = Element.prototype
  const top = Object.getOwnPropertyDescriptor(proto, "scrollTop")
  const scrollTo = proto.scrollTo
  const scrollBy = proto.scrollBy
  const intoView = proto.scrollIntoView
  const setTop = top?.set
  if (!top || !setTop) return
  Object.defineProperty(proto, "scrollTop", {
    ...top,
    set(this: Element, v: number) {
      wrote = true
      push("scrollTop=", this, Math.round(v))
      setTop.call(this, v)
    },
  })
  proto.scrollTo = function (this: Element, a?: ScrollToOptions | number, b?: number) {
    wrote = true
    push("scrollTo", this, typeof a === "number" ? Math.round(b ?? 0) : Math.round(a?.top ?? -1))
    Reflect.apply(scrollTo, this, typeof a === "number" ? [a, b ?? 0] : [a ?? {}])
  }
  proto.scrollBy = function (this: Element, a?: ScrollToOptions | number, b?: number) {
    wrote = true
    push("scrollBy", this, null)
    Reflect.apply(scrollBy, this, typeof a === "number" ? [a, b ?? 0] : [a ?? {}])
  }
  proto.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
    wrote = true
    push("scrollIntoView", this, null)
    return intoView.call(this, arg)
  }
  const onScroll = (e: Event) => {
    if (!(e.target instanceof Element)) return
    push(wrote ? "scroll" : "scroll (not from a script)", e.target, null)
    wrote = false
  }
  document.addEventListener("scroll", onScroll, true)
  const timer = window.setTimeout(stop, TRACE_MS)
  undo = () => {
    Object.defineProperty(proto, "scrollTop", top)
    proto.scrollTo = scrollTo
    proto.scrollBy = scrollBy
    proto.scrollIntoView = intoView
    document.removeEventListener("scroll", onScroll, true)
    window.clearTimeout(timer)
  }
}

export function scrollTrace(): string {
  const by = new Map<string, number>()
  for (const e of entries) if (e.what !== "scroll") by.set(`${e.what} ${e.el} ${e.stack}`, (by.get(`${e.what} ${e.el} ${e.stack}`) ?? 0) + 1)
  const writers = [...by].sort((a, b) => b[1] - a[1]).slice(0, 20)
  return JSON.stringify({ agent: navigator.userAgent, size: `${innerWidth}x${innerHeight}`, entries: entries.length, writers, last: entries.slice(-300) }, null, 1)
}
