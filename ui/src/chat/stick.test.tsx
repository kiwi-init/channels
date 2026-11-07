import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { useStick } from "~/chat/stick"

const VIEW_TOP = 60
const VIEW_H = 700
const LINE = 26.4
const DOC_PAD = 40

type Listener = () => void
type Stick = ReturnType<typeof useStick>

class Feed {
  rows: { seq: number; h: number }[] = []
  lines = 10
  top = 0
  observers = new Set<() => void>()
  listeners = new Map<string, Set<Listener>>()
  readonly spacer = { style: { height: "" } }
  private readonly rowEls = new Map<number, unknown>()

  constructor(rows: number) {
    for (let seq = 1; seq <= rows; seq++) this.rows.push({ seq, h: 52.8 })
  }

  get above(): number {
    return this.rows.reduce((sum, r) => sum + r.h, 0)
  }

  get listH(): number {
    return this.above + DOC_PAD + this.lines * LINE
  }

  get scrollHeight(): number {
    return Math.ceil(this.listH + (Number.parseFloat(this.spacer.style.height) || 0))
  }

  get max(): number {
    return Math.max(0, this.scrollHeight - VIEW_H)
  }

  get docTop(): number {
    return VIEW_TOP + this.above - this.top
  }

  scrollTo(v: number): void {
    this.top = Math.round(Math.min(this.max, Math.max(0, v)))
  }

  readonly box = {
    clientHeight: VIEW_H,
    getBoundingClientRect: () => ({ top: VIEW_TOP, bottom: VIEW_TOP + VIEW_H }),
    get scrollTop(): number {
      return feed().top
    },
    set scrollTop(v: number) {
      feed().scrollTo(v)
    },
    get scrollHeight(): number {
      return feed().scrollHeight
    },
    scrollTo: (o: { top: number }) => this.scrollTo(o.top),
    addEventListener: (kind: string, f: Listener) => {
      const set = this.listeners.get(kind) ?? new Set<Listener>()
      set.add(f)
      this.listeners.set(kind, set)
    },
    removeEventListener: (kind: string, f: Listener) => this.listeners.get(kind)?.delete(f),
  }

  readonly doc = {
    isConnected: true,
    classList: { contains: (c: string) => c === "thread-doc" },
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ top: this.docTop, bottom: this.docTop + DOC_PAD + this.lines * LINE }),
  }

  readonly list = {
    get offsetHeight(): number {
      return Math.round(feed().listH)
    },
    querySelector: (sel: string) => (sel === ".thread-doc" ? this.doc : null),
    querySelectorAll: () => this.rows.map((r) => this.rowEl(r.seq)),
  }

  rowEl(seq: number): unknown {
    const known = this.rowEls.get(seq)
    if (known) return known
    const at = (): number => {
      let y = VIEW_TOP - this.top
      for (const r of this.rows) {
        if (r.seq === seq) return y
        y += r.h
      }
      return Number.NaN
    }
    const el = {
      dataset: { seq: String(seq) },
      get isConnected(): boolean {
        return !Number.isNaN(at())
      },
      getClientRects: () => [{}],
      getBoundingClientRect: () => {
        const h = this.rows.find((r) => r.seq === seq)?.h ?? 0
        return { top: at(), bottom: at() + h }
      },
    }
    this.rowEls.set(seq, el)
    return el
  }

  fire(kind: string): void {
    for (const f of this.listeners.get(kind) ?? []) f()
  }

  resized(): void {
    for (const f of this.observers) f()
  }
}

let current: Feed | null = null
const feed = (): Feed => {
  if (!current) throw new Error("no feed")
  return current
}

const container = () => ({
  nodeType: 1,
  tagName: "DIV",
  nodeName: "DIV",
  namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener() {},
  removeEventListener() {},
  ownerDocument: { addEventListener() {}, removeEventListener() {}, defaultView: { HTMLIFrameElement: class {}, document: { activeElement: null } } },
})

const saved = { window: Reflect.get(globalThis, "window"), observer: Reflect.get(globalThis, "ResizeObserver"), act: Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT") }

beforeAll(() => {
  Reflect.set(globalThis, "window", globalThis)
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
  Reflect.set(
    globalThis,
    "ResizeObserver",
    class {
      readonly callback: () => void
      constructor(callback: () => void) {
        this.callback = callback
      }
      observe() {
        feed().observers.add(this.callback)
      }
      disconnect() {
        feed().observers.delete(this.callback)
      }
    }
  )
})

afterAll(() => {
  Reflect.set(globalThis, "window", saved.window)
  Reflect.set(globalThis, "ResizeObserver", saved.observer)
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", saved.act)
})

async function mount(f: Feed, following: boolean, still: boolean): Promise<{ stick: Stick; root: Root }> {
  current = f
  let stick: Stick | null = null
  const Probe = () => {
    const s = useStick(following, still)
    s.scroller.current ??= f.box as unknown as HTMLDivElement
    s.content.current ??= f.list as unknown as HTMLDivElement
    s.spacer.current ??= f.spacer as unknown as HTMLDivElement
    stick = s
    return null
  }
  const root = createRoot(container() as unknown as HTMLElement)
  await act(async () => root.render(<Probe />))
  if (!stick) throw new Error("the hook did not render")
  return { stick, root }
}

function userScroll(f: Feed, s: Stick, dy: number): void {
  f.fire("wheel")
  f.scrollTo(f.top + dy)
  s.remember()
}

function arrive(f: Feed, s: Stick, seq: number, h: number): void {
  f.rows.push({ seq, h })
  s.settle()
  f.resized()
}

function docLine(f: Feed): void {
  f.lines++
  f.resized()
}

describe("useStick in a thread doc", () => {
  test("lines arriving above the doc you read leave it where it is", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    userScroll(f, stick, -200)
    const before = f.docTop
    for (let seq = 101; seq <= 110; seq++) {
      arrive(f, stick, seq, seq % 3 ? 52.8 : 79.2)
      docLine(f)
    }
    expect(Math.abs(f.docTop - before)).toBeLessThan(4)
    await act(async () => root.unmount())
  })

  test("a doc line that grows while you start scrolling up from the bottom does not pull you back down", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    userScroll(f, stick, -17)
    const reading = f.top
    docLine(f)
    expect(f.top).toBe(reading)
    userScroll(f, stick, -183)
    const before = f.docTop
    for (let i = 0; i < 8; i++) docLine(f)
    expect(f.docTop).toBe(before)
    await act(async () => root.unmount())
  })

  test("a line that arrives while you start scrolling up from the bottom does not pull you back down", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    userScroll(f, stick, -17)
    const before = f.docTop
    arrive(f, stick, 101, 52.8)
    expect(Math.abs(f.docTop - before)).toBeLessThan(1)
    stick.remember()
    docLine(f)
    expect(Math.abs(f.docTop - before)).toBeLessThan(1)
    expect(f.max - f.top).toBeGreaterThan(8)
    await act(async () => root.unmount())
  })

  test("the scroll you make between a line's arrival and its correction is kept", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    userScroll(f, stick, -200)
    const before = f.docTop
    f.rows.push({ seq: 101, h: 52.8 })
    f.scrollTo(f.top - 30)
    stick.settle()
    f.resized()
    expect(Math.abs(f.docTop - (before + 30))).toBeLessThan(1)
    await act(async () => root.unmount())
  })

  test("sitting at the bottom, you follow the doc as it grows", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    for (let i = 0; i < 5; i++) {
      docLine(f)
      expect(f.top).toBe(f.max)
    }
    await act(async () => root.unmount())
  })

  test("held, or reading an older window, the bottom does not pull you along", async () => {
    for (const how of ["held", "behind"] as const) {
      const f = new Feed(100)
      const { stick, root } = await mount(f, how === "held", true)
      f.scrollTo(f.max)
      f.fire("wheel")
      stick.remember()
      if (how === "held") stick.hold(true)
      const before = f.docTop
      for (let i = 0; i < 3; i++) docLine(f)
      expect(f.docTop).toBe(before)
      await act(async () => root.unmount())
    }
  })

  test("unmounting stops watching the feed", async () => {
    const f = new Feed(100)
    const { root } = await mount(f, true, true)
    expect(f.observers.size).toBe(1)
    expect(f.listeners.get("wheel")?.size).toBe(1)
    await act(async () => root.unmount())
    expect(f.observers.size).toBe(0)
    for (const set of f.listeners.values()) expect(set.size).toBe(0)
  })
})
