import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { useStick } from "~/chat/stick"

const VIEW_TOP = 60
const VIEW_H = 700
const LINE = 26.4
const DOC_PAD = 40

type Listener = (e: { deltaY: number; type: string }) => void

let clock = Date.parse("2026-01-01T00:00:00Z")

function later(ms = 1_000): void {
  clock += ms
  setSystemTime(new Date(clock))
}
type Stick = ReturnType<typeof useStick>

class Feed {
  rows: { seq: number; h: number }[] = []
  lines = 10
  pad = 0
  top = 0
  width = 800
  working = 0
  whole: (v: number) => number = Math.round
  observers = new Set<() => void>()
  listeners = new Map<string, Set<Listener>>()
  docListeners = new Map<string, Set<Listener>>()
  readonly spacer = { style: { height: "" } }
  private readonly rowEls = new Map<number, unknown>()

  constructor(rows: number) {
    for (let seq = 1; seq <= rows; seq++) this.rows.push({ seq, h: 52.8 })
  }

  get above(): number {
    return this.rows.reduce((sum, r) => sum + r.h, 0)
  }

  get natural(): number {
    return this.above + DOC_PAD + this.lines * LINE + this.working + this.pad
  }

  get listH(): number {
    return Math.max(VIEW_H, this.natural)
  }

  get lift(): number {
    return this.listH - this.natural
  }

  get scrollHeight(): number {
    return Math.ceil(this.listH + (Number.parseFloat(this.spacer.style.height) || 0))
  }

  get max(): number {
    return Math.max(0, this.scrollHeight - VIEW_H)
  }

  get docTop(): number {
    return VIEW_TOP + this.lift + this.above - this.top
  }

  get docEnd(): number {
    return this.docTop + DOC_PAD + this.lines * LINE
  }

  scrollTo(v: number): void {
    this.top = this.whole(Math.min(this.max, Math.max(0, v)))
  }

  readonly box = {
    clientHeight: VIEW_H,
    get clientWidth(): number {
      return feed().width
    },
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
    ownerDocument: {
      addEventListener: (kind: string, f: Listener) => {
        const set = this.docListeners.get(kind) ?? new Set<Listener>()
        set.add(f)
        this.docListeners.set(kind, set)
      },
      removeEventListener: (kind: string, f: Listener) => this.docListeners.get(kind)?.delete(f),
    },
  }

  readonly doc = {
    isConnected: true,
    classList: { contains: (c: string) => c === "thread-doc" },
    previousElementSibling: null,
    hasAttribute: () => false,
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ top: this.docTop, bottom: this.docEnd }),
  }

  readonly workingLine = {
    isConnected: true,
    previousElementSibling: this.doc,
    hasAttribute: (name: string) => name === "data-aside",
    getClientRects: () => (this.working > 0 ? [{}] : []),
    getBoundingClientRect: () => (this.working > 0 ? { top: this.docEnd, bottom: this.docEnd + this.working } : { top: 0, bottom: 0 }),
  }

  readonly list = {
    get offsetHeight(): number {
      return Math.round(feed().listH)
    },
    lastElementChild: this.workingLine,
    querySelector: (sel: string) => (sel === ".thread-doc" ? this.doc : null),
    querySelectorAll: () => this.rows.map((r) => this.rowEl(r.seq)),
  }

  rowEl(seq: number): unknown {
    const known = this.rowEls.get(seq)
    if (known) return known
    const at = (): number => {
      let y = VIEW_TOP + this.lift - this.top
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

  fireDoc(kind: string): void {
    for (const f of this.docListeners.get(kind) ?? []) f({ deltaY: 0, type: kind })
  }

  fire(kind: string, deltaY = 0): void {
    for (const f of this.listeners.get(kind) ?? []) f({ deltaY, type: kind })
    this.fireDoc(kind)
  }

  layout(): boolean {
    const clamped = this.top > this.max
    if (clamped) this.top = this.max
    return clamped
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
  setSystemTime(new Date(clock))
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
  setSystemTime()
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
  f.fire("wheel", dy)
  f.scrollTo(f.top + dy)
  s.remember()
  later()
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

const WORKING = 27

const SIDE = 320

function relaid(f: Feed, s: Stick, change: { width?: number; rowH?: number; lines?: number; working?: number }): void {
  if (change.width !== undefined) f.width = change.width
  if (change.rowH !== undefined) for (const r of f.rows) r.h = change.rowH
  if (change.lines !== undefined) f.lines = change.lines
  if (change.working !== undefined) f.working = change.working
  const from = f.top
  f.layout()
  f.resized()
  if (f.top !== from) s.remember()
}

const room = (f: Feed): number => Number.parseFloat(f.spacer.style.height) || 0

const rowTop = (f: Feed, seq: number): number => (f.rowEl(seq) as { getBoundingClientRect: () => { top: number } }).getBoundingClientRect().top

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

  test("a wheel scroll still animating up from the bottom when a line arrives is not pulled back down (#2025)", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    const from = f.top
    f.fire("wheel", -58)
    f.scrollTo(from - 58)
    f.rows.push({ seq: 101, h: 52.8 })
    stick.settle()
    expect(f.listH - VIEW_H - f.top).toBeGreaterThanOrEqual(100)
    later()
    const before = f.docTop
    arrive(f, stick, 102, 52.8)
    expect(Math.abs(f.docTop - before)).toBeLessThan(1)
    await act(async () => root.unmount())
  })

  test("a row the window drops above you while a wheel scroll animates up leaves the scroll room to carry on (#2025)", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    f.fire("wheel", -200)
    f.scrollTo(f.top - 7)
    stick.remember()
    f.rows.shift()
    f.rows.push({ seq: 101, h: 28.8 })
    expect(f.layout()).toBe(false)
    stick.settle()
    f.resized()
    f.scrollTo(f.top - 193)
    stick.remember()
    expect(f.top).toBeLessThan(f.listH - VIEW_H - 150)
    later()
    stick.remember()
    expect(f.spacer.style.height).toBe("")
    expect(f.layout()).toBe(false)
    await act(async () => root.unmount())
  })

  test("without a reserve, the same dropped row clamps the view to the bottom, which is what cancels WebKit's wheel scroll", () => {
    const f = new Feed(100)
    f.scrollTo(f.max - 7)
    f.rows.shift()
    f.rows.push({ seq: 101, h: 28.8 })
    expect(f.layout()).toBe(true)
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

  test("reversing a wheel back down to the bottom leaves no blank space, and lines that arrive are followed", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    f.fire("wheel", -200)
    f.scrollTo(f.top - 7)
    stick.remember()
    expect(f.spacer.style.height).toBe(`${VIEW_H}px`)
    f.fire("wheel", 1000)
    f.layout()
    f.scrollTo(f.max)
    stick.remember()
    expect(f.spacer.style.height).toBe("")
    expect(f.top).toBe(f.max)
    later()
    stick.remember()
    expect(f.spacer.style.height).toBe("")
    arrive(f, stick, 101, 52.8)
    docLine(f)
    expect(f.max - f.top).toBeLessThan(1)
    await act(async () => root.unmount())
  })

  test("a reserve left by a wheel that stopped is released once the wheel is over, wherever you are", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    f.fire("wheel", -200)
    f.scrollTo(f.max)
    stick.remember()
    later()
    stick.remember()
    expect(f.spacer.style.height).toBe("")
    f.layout()
    expect(f.top).toBe(f.max)
    await act(async () => root.unmount())
  })

  test("a wheel down at the bottom reserves no room, and lines that arrive are followed", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    f.fire("wheel", 120)
    stick.remember()
    expect(f.spacer.style.height).toBe("")
    later()
    arrive(f, stick, 101, 52.8)
    docLine(f)
    expect(f.max - f.top).toBeLessThan(1)
    await act(async () => root.unmount())
  })

  test("a picture row that collapses to its placeholder at the bottom, with a line landing before the clamp's scroll event, is still followed (#2399)", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    arrive(f, stick, 101, 172.8)
    expect(f.max - f.top).toBeLessThan(1)
    const picture = f.rows.at(-1)
    if (!picture) throw new Error("no picture row")
    picture.h -= 120
    expect(f.layout()).toBe(true)
    f.resized()
    arrive(f, stick, 102, 52.8)
    expect(f.max - f.top).toBeLessThan(1)
    arrive(f, stick, 103, 52.8)
    docLine(f)
    expect(f.max - f.top).toBeLessThan(1)
    await act(async () => root.unmount())
  })

  test("a composer that grows and shrinks back under a thread shorter than the view leaves no blank space under it", async () => {
    const f = new Feed(3)
    const { root } = await mount(f, true, true)
    f.fire("pointerdown")
    const before = f.docTop
    f.pad = 168
    f.resized()
    expect(f.docTop).toBe(before - 168)
    f.pad = 0
    f.resized()
    expect(f.spacer.style.height).toBe("")
    expect(f.top).toBe(0)
    expect(f.docTop).toBe(before)
    await act(async () => root.unmount())
  })

  test("in a thread shorter than the view, the doc you read stays put when a line under it leaves, with room under it", async () => {
    const f = new Feed(3)
    const { root } = await mount(f, true, true)
    f.fire("pointerdown")
    const before = f.docTop
    f.lines--
    f.resized()
    expect(Math.abs(f.docTop - before)).toBeLessThan(1)
    expect(Math.abs(Number.parseFloat(f.spacer.style.height) - LINE)).toBeLessThan(0.01)
    await act(async () => root.unmount())
  })

  test("a trackpad pull past the bottom that springs back as the channel updates leaves no blank space", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    f.fire("wheel", 40)
    f.top = f.max + 150
    stick.remember()
    later()
    f.top = f.max
    stick.settle()
    expect(f.spacer.style.height).toBe("")
    expect(f.top).toBe(f.max)
    await act(async () => root.unmount())
  })

  test("a view left in the reserve, pulled back by the browser as the channel updates, leaves no blank space", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    const end = f.top
    f.fire("wheel", -200)
    f.scrollTo(end - 7)
    stick.remember()
    f.scrollTo(end + 120)
    stick.remember()
    expect(f.top).toBe(end + 120)
    later()
    stick.remember()
    expect(f.spacer.style.height).toBe("")
    expect(f.layout()).toBe(true)
    stick.settle()
    expect(f.spacer.style.height).toBe("")
    expect(f.top).toBe(end)
    await act(async () => root.unmount())
  })

  test("an upward wheel reserves no room where there is nothing above to scroll to, or from past the bottom", async () => {
    const short = new Feed(3)
    const a = await mount(short, true, true)
    short.fire("wheel", -200)
    expect(short.spacer.style.height).toBe("")
    await act(async () => a.root.unmount())
    const long = new Feed(100)
    const b = await mount(long, true, true)
    long.scrollTo(long.max)
    b.stick.remember()
    long.top = long.max + 120
    long.fire("wheel", -30)
    expect(long.spacer.style.height).toBe("")
    await act(async () => b.root.unmount())
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

  test("at the bottom, rows that shrink twice and grow back, as a late font does, keep you at the bottom (T2635)", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    for (const r of f.rows) r.h -= 2.4
    stick.settle()
    expect(f.top).toBe(f.max)
    for (const r of f.rows) r.h -= 0.6
    f.scrollTo(f.top)
    stick.settle()
    expect(f.top).toBe(f.max)
    for (const r of f.rows) r.h += 0.4
    stick.remember()
    expect(f.top).toBe(f.max)
    docLine(f)
    expect(f.top).toBe(f.max)
    await act(async () => root.unmount())
  })

  test("at the bottom, rows that shrink a lot as the conversation opens, then grow a little, keep you at the bottom (T2635)", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    stick.settle()
    for (const r of f.rows) r.h -= 17
    f.layout()
    for (const r of f.rows) r.h += 1.7
    stick.remember()
    expect(f.top).toBe(f.max)
    docLine(f)
    expect(f.top).toBe(f.max)
    await act(async () => root.unmount())
  })

  test("a scrollbar held longer than a wheel lasts still leaves follow when it drags up from the bottom (T2635)", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    f.fireDoc("pointerdown")
    later(2_000)
    f.scrollTo(f.top - 20)
    const reading = f.top
    docLine(f)
    expect(f.top).toBe(reading)
    stick.remember()
    for (let i = 0; i < 3; i++) docLine(f)
    expect(f.top).toBe(reading)
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

  test("a reader's scroll that lands with a resize above is kept, not undone, when its scroll event arrives (#2295)", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, false)
    stick.toRow(f.rowEl(20) as HTMLElement, -10)
    f.fireDoc("wheel")
    f.scrollTo(f.top + 100)
    const read = f.top
    f.rows[0]!.h += 50
    stick.remember()
    expect(Math.abs(f.top - (read + 50))).toBeLessThan(2)
    await act(async () => root.unmount())
  })

  test("a restored row stays put when content below shrinks and the browser pulls the scroll back (#2295)", async () => {
    const f = new Feed(100)
    f.lines = 60
    const { stick, root } = await mount(f, true, false)
    stick.toRow(f.rowEl(95) as HTMLElement, -20)
    const at = (f.rowEl(95) as HTMLElement).getBoundingClientRect().top - VIEW_TOP
    for (const r of f.rows.slice(0, 10)) r.h -= 40
    f.lines = 20
    f.scrollTo(f.top)
    stick.settle()
    expect(Math.abs((f.rowEl(95) as HTMLElement).getBoundingClientRect().top - VIEW_TOP - at)).toBeLessThan(2)
    await act(async () => root.unmount())
  })

  test("a reader who scrolls away from a restore before content shrinks keeps their place, not the restored one (#2295)", async () => {
    const f = new Feed(100)
    f.lines = 60
    const { stick, root } = await mount(f, true, false)
    stick.toRow(f.rowEl(95) as HTMLElement, -20)
    f.fireDoc("wheel")
    f.scrollTo(f.top - 1000)
    const read = f.top
    for (const r of f.rows.slice(0, 10)) r.h -= 40
    f.lines = 20
    expect(f.top).toBeLessThan(f.max)
    stick.remember()
    expect(Math.abs(f.top - (read - 400))).toBeLessThan(2)
    await act(async () => root.unmount())
  })

  test("a key or a pointer anywhere on the page, such as keyboard scrolling or a scrollbar drag, releases a restore (#2295)", async () => {
    for (const still of [false, true])
      for (const kind of ["keydown", "pointerdown", "touchstart"]) {
        const f = new Feed(100)
        const { stick, root } = await mount(f, true, still)
        stick.toRow(f.rowEl(20) as HTMLElement, -10)
        f.fireDoc(kind)
        f.scrollTo(f.top + 100)
        const read = f.top
        f.rows[0]!.h += 50
        stick.remember()
        expect(Math.abs(f.top - (read + 50))).toBeLessThan(2)
        await act(async () => root.unmount())
        expect(f.docListeners.get(kind)?.size ?? 0).toBe(0)
      }
  })

  test("the app's own scrolls release a restore: a jump, an unstick or the bottom (#2295)", async () => {
    for (const how of ["toOffset", "unstick", "toBottom"] as const) {
      const f = new Feed(100)
      const { stick, root } = await mount(f, true, false)
      stick.toRow(f.rowEl(20) as HTMLElement, -10)
      if (how === "toOffset") stick.toOffset(f.top + 300)
      if (how === "unstick") stick.unstick()
      if (how === "toBottom") stick.toBottom(false)
      if (how !== "toBottom") f.scrollTo(f.top + 100)
      const read = f.top
      stick.remember()
      f.rows[0]!.h += 50
      stick.settle()
      expect(Math.abs(f.top - (how === "toBottom" ? f.max : read + 50))).toBeLessThan(2)
      await act(async () => root.unmount())
    }
  })

  test("a restore stops holding once its time is up, so later scrolling isn't fought (#2295)", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, false)
    stick.toRow(f.rowEl(20) as HTMLElement, -10)
    later(5_000)
    f.scrollTo(f.top + 100)
    const moved = f.top
    f.rows[0]!.h += 50
    stick.remember()
    expect(Math.abs(f.top - (moved + 50))).toBeLessThan(2)
    await act(async () => root.unmount())
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

describe("useStick when the feed changes width (T231)", () => {
  test("at the bottom, the working line under the doc coming and going never leaves blank room, round after round", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    f.fire("pointerdown")
    for (let round = 0; round < 3; round++) {
      relaid(f, stick, { working: WORKING })
      expect(f.top).toBe(f.max)
      relaid(f, stick, { working: 0 })
      expect(room(f)).toBe(0)
      expect(f.top).toBe(f.max)
    }
    await act(async () => root.unmount())
  })

  test("hiding and showing the sidebar at the bottom leaves the last line on the composer, with no blank room, after any number of rounds", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    f.fire("pointerdown")
    for (let round = 0; round < 3; round++) {
      relaid(f, stick, { width: 800 + SIDE, rowH: 52.8, lines: 8, working: WORKING })
      expect(room(f)).toBe(0)
      expect(f.top).toBe(f.max)
      relaid(f, stick, { width: 800, rowH: 79.2, lines: 10, working: 0 })
      expect(room(f)).toBe(0)
      expect(f.top).toBe(f.max)
    }
    await act(async () => root.unmount())
  })

  test("a wider feed that unwraps the doc's own lines is not a line leaving the doc: at the bottom it adds no room", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    f.fire("pointerdown")
    relaid(f, stick, { width: 800 + SIDE, lines: 7 })
    expect(room(f)).toBe(0)
    expect(f.top).toBe(f.max)
    await act(async () => root.unmount())
  })

  test("a narrower feed that wraps more lines keeps a reader at the bottom at the bottom", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    f.fire("pointerdown")
    relaid(f, stick, { width: 800 - SIDE, rowH: 105.6, lines: 16, working: WORKING })
    expect(room(f)).toBe(0)
    expect(f.top).toBe(f.max)
    await act(async () => root.unmount())
  })

  test("a width change at the bottom takes back the room a leaving doc line had left", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    f.fire("pointerdown")
    relaid(f, stick, { lines: 9 })
    expect(Math.abs(room(f) - LINE)).toBeLessThan(0.01)
    relaid(f, stick, { width: 800 + SIDE })
    expect(room(f)).toBe(0)
    expect(f.top).toBe(f.max)
    await act(async () => root.unmount())
  })

  test("scrolled up, the row being read stays where it is through a wider and a narrower feed, and no room is added", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    userScroll(f, stick, -120)
    stick.remember()
    expect(room(f)).toBe(0)
    const reading = Math.min(...f.rows.map((r) => r.seq).filter((seq) => rowTop(f, seq) >= VIEW_TOP))
    const before = rowTop(f, reading)
    for (let round = 0; round < 3; round++) {
      relaid(f, stick, { width: 800 + SIDE, rowH: 39.6, lines: 8, working: WORKING })
      expect(room(f)).toBe(0)
      expect(rowTop(f, reading)).toBeGreaterThanOrEqual(VIEW_TOP)
      expect(rowTop(f, reading)).toBeLessThan(VIEW_TOP + VIEW_H)
      relaid(f, stick, { width: 800, rowH: 52.8, lines: 10, working: 0 })
      expect(room(f)).toBe(0)
      expect(Math.abs(rowTop(f, reading) - before)).toBeLessThan(2)
    }
    await act(async () => root.unmount())
  })

  test("a feed with no doc keeps the bottom at the bottom and a read row in view through a width change", async () => {
    const f = new Feed(100)
    const { stick, root } = await mount(f, true, false)
    f.scrollTo(f.max)
    stick.remember()
    relaid(f, stick, { width: 800 + SIDE, rowH: 39.6, working: WORKING })
    expect(f.top).toBe(f.max)
    relaid(f, stick, { width: 800, rowH: 52.8, working: 0 })
    expect(f.top).toBe(f.max)
    expect(room(f)).toBe(0)
    userScroll(f, stick, -400)
    const first = Math.min(...f.rows.map((r) => r.seq).filter((seq) => rowTop(f, seq) + 52.8 > VIEW_TOP))
    const before = rowTop(f, first)
    relaid(f, stick, { width: 800 + SIDE, rowH: 39.6 })
    expect(rowTop(f, first) + 39.6).toBeGreaterThan(VIEW_TOP)
    expect(rowTop(f, first)).toBeLessThan(VIEW_TOP + VIEW_H)
    relaid(f, stick, { width: 800, rowH: 52.8 })
    expect(Math.abs(rowTop(f, first) - before)).toBeLessThan(2)
    expect(room(f)).toBe(0)
    await act(async () => root.unmount())
  })

  test("in a browser that scrolls by whole pixels, a doc read while scrolled up is back on its pixel after ten rounds of hide and show", async () => {
    const f = new Feed(31)
    f.whole = Math.floor
    const { stick, root } = await mount(f, true, true)
    f.scrollTo(f.max)
    stick.remember()
    userScroll(f, stick, -120)
    stick.remember()
    expect(room(f)).toBe(0)
    const before = f.docTop
    expect(before).toBeLessThan(VIEW_TOP + VIEW_H)
    for (let round = 0; round < 10; round++) {
      relaid(f, stick, { width: 800 + SIDE, rowH: 39.6, working: WORKING })
      relaid(f, stick, { width: 800, rowH: 52.8, working: 0 })
    }
    expect(Math.abs(f.docTop - before)).toBeLessThan(2)
    expect(room(f)).toBe(0)
    await act(async () => root.unmount())
  })

  test("a reader a little above the end, pulled to the end by a wider feed, is back on their row when the width is back", async () => {
    for (const still of [false, true]) {
      const f = new Feed(101)
      f.whole = Math.floor
      const { stick, root } = await mount(f, true, still)
      f.scrollTo(f.max)
      stick.remember()
      userScroll(f, stick, -60)
      stick.remember()
      expect(room(f)).toBe(0)
      const first = Math.min(...f.rows.map((r) => r.seq).filter((seq) => rowTop(f, seq) + 52.8 > VIEW_TOP))
      const before = rowTop(f, first)
      const above = f.max - f.top
      expect(above).toBeGreaterThan(50)
      for (let round = 0; round < 5; round++) {
        relaid(f, stick, { width: 800 + SIDE, rowH: 39.6, lines: 7 })
        expect(f.top).toBe(f.max)
        expect(rowTop(f, first)).toBeLessThan(VIEW_TOP + VIEW_H)
        expect(room(f)).toBe(0)
        relaid(f, stick, { width: 800, rowH: 52.8, lines: 10 })
        expect(Math.abs(rowTop(f, first) - before)).toBeLessThan(2)
        expect(Math.abs(f.max - f.top - above)).toBeLessThan(2)
        expect(room(f)).toBe(0)
      }
      await act(async () => root.unmount())
    }
  })

  test("pulled to the end by a wider feed, a reader who then follows a new message or scrolls is not taken back", async () => {
    for (const leave of ["a new message", "a scroll"] as const) {
      const f = new Feed(101)
      const { stick, root } = await mount(f, true, false)
      f.scrollTo(f.max)
      stick.remember()
      userScroll(f, stick, -100)
      stick.remember()
      relaid(f, stick, { width: 800 + SIDE, rowH: 39.6, lines: 7 })
      expect(f.top).toBe(f.max)
      if (leave === "a new message") {
        arrive(f, stick, 102, 39.6)
        expect(f.top).toBe(f.max)
        relaid(f, stick, { width: 800, rowH: 52.8, lines: 10 })
        expect(f.top).toBe(f.max)
      } else {
        userScroll(f, stick, -400)
        stick.remember()
        const first = Math.min(...f.rows.map((r) => r.seq).filter((seq) => rowTop(f, seq) + 39.6 > VIEW_TOP))
        const share = (VIEW_TOP - rowTop(f, first)) / 39.6
        relaid(f, stick, { width: 800, rowH: 52.8, lines: 10 })
        expect(Math.abs((VIEW_TOP - rowTop(f, first)) / 52.8 - share)).toBeLessThan(0.05)
      }
      await act(async () => root.unmount())
    }
  })

  test("a row cut by the top edge keeps the same share of itself hidden, so ten rounds of hide and show end where they began", async () => {
    for (const still of [false, true]) {
      const f = new Feed(100)
      const { stick, root } = await mount(f, true, still)
      f.scrollTo(f.max)
      stick.remember()
      userScroll(f, stick, -1000)
      stick.remember()
      const first = Math.min(...f.rows.map((r) => r.seq).filter((seq) => rowTop(f, seq) + 52.8 > VIEW_TOP))
      const before = rowTop(f, first)
      expect(before).toBeLessThan(VIEW_TOP - 10)
      for (let round = 0; round < 10; round++) {
        relaid(f, stick, { width: 800 + SIDE, rowH: 39.6, working: WORKING })
        stick.remember()
        expect(rowTop(f, first) + 39.6).toBeGreaterThan(VIEW_TOP)
        relaid(f, stick, { width: 800, rowH: 52.8, working: 0 })
        stick.remember()
      }
      expect(Math.abs(rowTop(f, first) - before)).toBeLessThan(2)
      expect(room(f)).toBe(0)
      await act(async () => root.unmount())
    }
  })
})

describe("useStick when rows far above leave the feed (T1211)", () => {
  const TALL = 40 * 52.8

  function leave(f: Feed, rows: number, lines: number): void {
    f.rows.splice(0, rows)
    f.lines -= lines
    f.layout()
  }

  test("the row being read stays where the reader's scroll put it when the end comes closer in the same step", async () => {
    const f = new Feed(200)
    const { stick, root } = await mount(f, false, false)
    f.scrollTo(f.max - TALL - 130)
    stick.remember()
    f.scrollTo(f.top + 120)
    const read = rowTop(f, 160)
    stick.lift(TALL)
    leave(f, 40, 2)
    stick.settle()
    expect(Math.abs(rowTop(f, 160) - read)).toBeLessThan(1)
    stick.remember()
    expect(Math.abs(rowTop(f, 160) - read)).toBeLessThan(1)
    await act(async () => root.unmount())
  })

  test("in a thread doc, mid-wheel, the row being read does not move", async () => {
    const f = new Feed(200)
    const { stick, root } = await mount(f, false, true)
    f.scrollTo(4000)
    stick.remember()
    f.fire("wheel", 120)
    f.scrollTo(f.top + 120)
    const read = rowTop(f, 85)
    stick.lift(TALL)
    leave(f, 40, 0)
    stick.settle()
    expect(Math.abs(rowTop(f, 85) - read)).toBeLessThan(1)
    stick.remember()
    expect(Math.abs(rowTop(f, 85) - read)).toBeLessThan(1)
    expect(room(f)).toBe(0)
    await act(async () => root.unmount())
  })

  test("a lift the scroll cannot make in full is corrected from the row being read", async () => {
    const f = new Feed(200)
    const { stick, root } = await mount(f, false, false)
    f.scrollTo(1500)
    stick.remember()
    const read = rowTop(f, 35)
    stick.lift(TALL)
    expect(f.top).toBe(0)
    leave(f, 20, 0)
    stick.settle()
    expect(Math.abs(rowTop(f, 35) - read)).toBeLessThan(1)
    await act(async () => root.unmount())
  })
})
