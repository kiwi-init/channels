import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test"
import { whileShown } from "~/live/shown"

const SWAPPED = ["document", "setInterval", "clearInterval"] as const
const saved = new Map(SWAPPED.map((name) => [name, Reflect.get(globalThis, name)]))

let hidden = false
let at = 1_000_000
let ticks: (() => void)[] = []
let cleared = 0
let listeners: (() => void)[] = []

const passTime = (ms: number): void => {
  at += ms
  setSystemTime(new Date(at))
  for (const tick of ticks) tick()
}

const setHidden = (next: boolean): void => {
  hidden = next
  for (const listener of listeners) listener()
}

beforeEach(() => {
  hidden = false
  at = 1_000_000
  ticks = []
  cleared = 0
  listeners = []
  setSystemTime(new Date(at))
  Reflect.set(globalThis, "document", {
    get hidden() {
      return hidden
    },
    addEventListener: (_: string, listener: () => void) => void listeners.push(listener),
    removeEventListener: (_: string, listener: () => void) => void (listeners = listeners.filter((l) => l !== listener)),
  })
  Reflect.set(globalThis, "setInterval", (tick: () => void) => {
    ticks.push(tick)
    return ticks.length
  })
  Reflect.set(globalThis, "clearInterval", () => void (cleared += 1))
})

afterEach(() => void setSystemTime())

afterAll(() => {
  for (const [name, value] of saved) Reflect.set(globalThis, name, value)
})

describe("polling pauses while the app is hidden (T917)", () => {
  test("a shown window runs every round", () => {
    let runs = 0
    whileShown(() => void (runs += 1), 15_000)
    passTime(15_000)
    passTime(15_000)
    expect(runs).toBe(2)
  })

  test("a hidden window makes no call, and showing it makes exactly one", () => {
    let runs = 0
    whileShown(() => void (runs += 1), 15_000)
    setHidden(true)
    passTime(15_000)
    passTime(15_000)
    expect(runs).toBe(0)
    setHidden(false)
    expect(runs).toBe(1)
  })

  test("a hidden window with a slow round runs only at that pace", () => {
    let runs = 0
    whileShown(() => void (runs += 1), 30_000, 600_000)
    setHidden(true)
    for (let i = 0; i < 19; i += 1) passTime(30_000)
    expect(runs).toBe(0)
    passTime(30_000)
    expect(runs).toBe(1)
    passTime(30_000)
    expect(runs).toBe(1)
  })

  test("stopping clears the timer and stops listening", () => {
    let runs = 0
    const stop = whileShown(() => void (runs += 1), 15_000)
    stop()
    expect(cleared).toBe(1)
    expect(listeners.length).toBe(0)
    expect(runs).toBe(0)
  })
})
