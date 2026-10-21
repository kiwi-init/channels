import { describe, expect, test } from "bun:test"

import { arrivedAfter, pin, resized, scrolled, type Follow } from "./use-scroll"
import { unreadOf } from "./use-news"

describe("what counts as new", () => {
  test("only messages newer than the newest one seen, so clearing a search or showing older ones adds none", () => {
    const seen = 40
    expect(arrivedAfter([{ seq: 38 }, { seq: 39 }, { seq: 40 }], seen)).toBe(0)
    expect(arrivedAfter([{ seq: 1 }, { seq: 2 }, { seq: 39 }, { seq: 40 }, { seq: 41 }, { seq: 42 }], seen)).toBe(2)
    expect(arrivedAfter([{ seq: 5 }, { seq: 6 }], 0)).toBe(2)
  })

  test("unread in a hidden window never goes below zero when history is trimmed", () => {
    expect(unreadOf(true, 12, 10, 0)).toBe(2)
    expect(unreadOf(true, 4, 10, 0)).toBe(0)
    expect(unreadOf(false, 4, 10, 3)).toBe(3)
  })
})

describe("staying at the newest message", () => {
  const scroller = (height: number) => {
    let top = 0
    let h = height
    const clientHeight = 884
    const clamp = (to: number) => Math.max(0, Math.min(to, h - clientHeight))
    return {
      clientHeight,
      get scrollHeight() {
        return h
      },
      set scrollHeight(to: number) {
        h = to
        top = clamp(top)
      },
      get scrollTop() {
        return top
      },
      set scrollTop(to: number) {
        top = clamp(to)
      },
    }
  }
  const gap = (el: ReturnType<typeof scroller>) => el.scrollHeight - el.scrollTop - el.clientHeight

  test("content that shrinks and then grows before the scroll event lands leaves it at the bottom, not where the browser clamped it", () => {
    const el = scroller(1596)
    const f: Follow = { atBottom: true, lastTop: 0 }
    el.scrollTop = el.scrollHeight
    scrolled(el, f)
    el.scrollHeight = 1535
    resized(el, f, false)
    el.scrollHeight = 1785
    scrolled(el, f)
    resized(el, f, false)
    expect(f.atBottom).toBe(true)
    expect(gap(el)).toBe(0)
  })

  test("a person scrolling up stays where they went as content grows, and back at the bottom it follows again", () => {
    const el = scroller(1596)
    const f: Follow = { atBottom: true, lastTop: 0 }
    el.scrollTop = el.scrollHeight
    scrolled(el, f)
    el.scrollTop -= 300
    scrolled(el, f)
    el.scrollHeight = 1846
    resized(el, f, false)
    expect(f.atBottom).toBe(false)
    expect(el.scrollTop).toBe(412)
    el.scrollTop = el.scrollHeight
    scrolled(el, f)
    el.scrollHeight = 1900
    resized(el, f, false)
    expect(gap(el)).toBe(0)
  })

  test("while a smooth scroll runs, growing content doesn't jump it to the bottom", () => {
    const el = scroller(1596)
    const f: Follow = { atBottom: true, lastTop: 0 }
    el.scrollTop = 600
    el.scrollHeight = 1700
    resized(el, f, true)
    expect(el.scrollTop).toBe(600)
    expect(f.lastTop).toBe(600)
  })

  test("content that shrinks and then grows during a smooth scroll leaves it at the bottom once the scroll settles", () => {
    const el = scroller(1596)
    const f: Follow = { atBottom: true, lastTop: 0 }
    pin(el, f)
    el.scrollHeight = 1700
    el.scrollTop = 750
    scrolled(el, f)
    el.scrollHeight = 1535
    resized(el, f, true)
    el.scrollHeight = 1785
    scrolled(el, f)
    resized(el, f, true)
    expect(f.atBottom).toBe(true)
    pin(el, f)
    expect(gap(el)).toBe(0)
  })

  test("after a switch from a longer place, content that grows before the first scroll event leaves it at the bottom", () => {
    const el = scroller(1596)
    const f: Follow = { atBottom: true, lastTop: 3000 }
    pin(el, f)
    expect(f.lastTop).toBe(712)
    el.scrollHeight = 1846
    scrolled(el, f)
    resized(el, f, false)
    expect(f.atBottom).toBe(true)
    expect(gap(el)).toBe(0)
  })
})
