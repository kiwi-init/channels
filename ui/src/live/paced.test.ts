import { describe, expect, test } from "bun:test"
import { FOCUS_GAP_MS, paced } from "~/live/paced"

const tick = () => new Promise<void>((done) => setTimeout(done, 0))

describe("what a window focus reloads is asked for once, not on every focus (T1782)", () => {
  test("ten focuses in a row are one call", async () => {
    let calls = 0
    let at = 0
    const got: number[] = []
    const load = paced(
      async () => ++calls,
      (n) => void got.push(n),
      FOCUS_GAP_MS,
      () => at
    )
    for (let i = 0; i < 10; i++) load()
    await tick()
    for (let i = 0; i < 10; i++) load()
    await tick()
    expect(calls).toBe(1)
    expect(got).toEqual([1])
    at = FOCUS_GAP_MS
    load()
    await tick()
    expect(calls).toBe(2)
    expect(got).toEqual([1, 2])
  })

  test("a focus while the first call is still out doesn't start a second", async () => {
    let calls = 0
    let answer: (n: number) => void = () => {}
    const load = paced(
      () => new Promise<number>((done) => ((calls += 1), (answer = done))),
      () => {},
      0,
      () => 0
    )
    load()
    load()
    expect(calls).toBe(1)
    answer(1)
    await tick()
    load()
    expect(calls).toBe(2)
  })

  test("a call that failed is tried again at the next focus", async () => {
    let calls = 0
    const got: string[] = []
    const load = paced(
      async () => {
        if (++calls === 1) throw new Error("the daemon is starting")
        return "seats"
      },
      (v) => void got.push(v),
      FOCUS_GAP_MS,
      () => 0
    )
    load()
    await tick()
    load()
    await tick()
    expect(calls).toBe(2)
    expect(got).toEqual(["seats"])
  })
})
