import { describe, expect, test } from "bun:test"

import { freshPace, paced, type Verdict } from "~/meadow/pace"

const run = (frames: readonly number[]): { verdict: Verdict; at: number } => {
  const p = freshPace()
  let at = 0
  for (const f of frames) {
    at += f
    const v = paced(p, f)
    if (v !== "measuring") return { verdict: v, at }
  }
  return { verdict: "measuring", at }
}

const steady = (fps: number, seconds: number): number[] => Array.from({ length: Math.ceil(fps * seconds) }, () => 1 / fps)

describe("the meadow's frame-rate verdict", () => {
  test("60 fps moves, 15 fps goes still after the sample", () => {
    expect(run(steady(60, 3)).verdict).toBe("fast")
    expect(run(steady(15, 3)).verdict).toBe("slow")
  })

  test("under 12 fps goes still well before the full sample", () => {
    const { verdict, at } = run(steady(8, 3))
    expect(verdict).toBe("slow")
    expect(at).toBeLessThan(1.6)
  })

  test("a busy start, a few long hitches right after the warm-up, still moves", () => {
    const busy = [...steady(60, 0.5), 0.25, 0.25, 0.25, ...steady(60, 2)]
    expect(run(busy).verdict).toBe("fast")
  })

  test("a hitch at every turn of a slow machine doesn't hide that it's slow", () => {
    const rough = Array.from({ length: 40 }, (_, i) => (i % 5 === 0 ? 0.3 : 1 / 15))
    expect(run(rough).verdict).toBe("slow")
  })
})
