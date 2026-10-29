import { describe, expect, test } from "bun:test"

import { FULL_SIZE, MAX_SIDE, attempts, renamed } from "./compress-image"
import { needsCompressing } from "./needs-compressing"

describe("compress-image", () => {
  test("the first attempt fits the longest side to the cap and never upscales", () => {
    const [first] = attempts(4096, 2048)
    expect(first).toEqual({ width: MAX_SIDE, height: MAX_SIDE / 2, quality: 0.9 })
    expect(attempts(800, 600)[0]).toEqual({ width: 800, height: 600, quality: 0.9 })
  })

  test("each attempt is no larger than the one before in scale, and a side is never zero", () => {
    const list = attempts(3000, 10)
    expect(list.every((a) => a.width >= 1 && a.height >= 1)).toBe(true)
    const widths = list.map((a) => a.width)
    expect(widths).toEqual([...widths].sort((x, y) => y - x))
  })

  test("only a still image over the limit is compressed", () => {
    expect(needsCompressing({ size: 300_000, type: "image/png" }, 262_144)).toBe(true)
    expect(needsCompressing({ size: 100_000, type: "image/png" }, 262_144)).toBe(false)
    expect(needsCompressing({ size: 300_000, type: "image/gif" }, 262_144)).toBe(false)
  })

  test("the new name carries the new type", () => {
    expect(renamed("shot.png", "image/webp")).toBe("shot.webp")
    expect(renamed("pasted.png", "image/jpeg")).toBe("pasted.jpg")
    expect(renamed("noext", "image/webp")).toBe("noext.webp")
  })
})

test("full size keeps every pixel first, and only then trades a little size", () => {
  const tries = attempts(2880, 1800, FULL_SIZE)
  expect(tries[0]).toEqual({ width: 2880, height: 1800, quality: 0.95 })
  expect(tries.slice(0, 4).every((a) => a.width === 2880 && a.height === 1800)).toBe(true)
  expect(Math.min(...tries.map((a) => a.width))).toBeGreaterThan(2880 / 2)
})
