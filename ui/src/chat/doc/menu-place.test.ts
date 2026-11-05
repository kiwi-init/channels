import { describe, expect, test } from "bun:test"
import { menuPlace } from "./menu-place"

const host = { top: 100, bottom: 900, left: 300, right: 1200 }
const frame = { top: 60, bottom: 860, left: 280, right: 1240 }
const size = { width: 460, height: 200 }

describe("the doc's / @ # menu stays on screen (T3783)", () => {
  test("opens under the caret when there is room", () => {
    expect(menuPlace({ left: 20, top: 120, above: 96 }, size, host, frame)).toEqual({ left: 20, top: 120, maxHeight: undefined })
  })

  test("opens above the caret when the caret sits at the bottom of the window", () => {
    const place = menuPlace({ left: 20, top: 720, above: 696 }, size, host, frame)
    expect(place.top).toBe(696 - 200)
    expect(place.maxHeight).toBeUndefined()
    expect(host.top + place.top).toBeGreaterThanOrEqual(frame.top)
  })

  test("caps its height to the larger side when neither fits", () => {
    const tall = { width: 460, height: 900 }
    const place = menuPlace({ left: 20, top: 300, above: 276 }, tall, host, frame)
    const below = frame.bottom - (host.top + 300) - 8
    expect(place).toEqual({ left: 20, top: 300, maxHeight: below })
  })

  test("never runs past the right edge", () => {
    const place = menuPlace({ left: 800, top: 120, above: 96 }, size, host, frame)
    expect(host.left + place.left + size.width).toBeLessThanOrEqual(frame.right - 8)
  })

  test("never starts left of the frame", () => {
    expect(menuPlace({ left: -40, top: 120, above: 96 }, size, host, frame).left).toBe(0)
  })
})
