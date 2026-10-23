import { describe, expect, test } from "bun:test"

import { ChannelGone, Unreachable } from "@kiwi/core/client.ts"

import { untilOpen } from "./until-open"

describe("untilOpen", () => {
  test("retries Unreachable then succeeds", async () => {
    let n = 0
    const status: string[] = []
    const open = async () => {
      n++
      if (n < 3) throw new Unreachable({ cause: new Error("blip") })
      return 42
    }
    expect(
      await untilOpen(
        open,
        (line) => void status.push(line),
        () => false,
        0
      )
    ).toBe(42)
    expect(n).toBe(3)
    expect(status).toEqual(["can't reach the relay; still retrying", "can't reach the relay; still retrying"])
  })

  test("a generic Error is a blip too", async () => {
    let n = 0
    const open = async () => {
      n++
      if (n === 1) throw new Error("502")
      return "ok"
    }
    expect(
      await untilOpen(
        open,
        () => {},
        () => false,
        0
      )
    ).toBe("ok")
    expect(n).toBe(2)
  })

  test("ChannelGone is not retried", async () => {
    let n = 0
    const status: string[] = []
    const open = async (): Promise<never> => {
      n++
      throw new ChannelGone("removed")
    }
    const err = await untilOpen(
      open,
      (line) => void status.push(line),
      () => false,
      0
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChannelGone)
    expect(n).toBe(1)
    expect(status).toEqual([])
  })

  test("a view that closed stops the retries", async () => {
    let n = 0
    let closed = false
    const open = async (): Promise<never> => {
      n++
      closed = true
      throw new Error("blip")
    }
    const err = await untilOpen(
      open,
      () => {},
      () => closed,
      0
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(n).toBe(1)
  })

  test("the wait doubles after each blip and stops at 30 s", async () => {
    const waits: number[] = []
    const real = globalThis.setTimeout
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      waits.push(ms ?? 0)
      return real(fn, 0)
    }) as typeof setTimeout
    try {
      let n = 0
      await untilOpen(
        async () => {
          if (++n < 9) throw new Error("blip")
          return n
        },
        () => {},
        () => false,
        500
      )
    } finally {
      globalThis.setTimeout = real
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })
})
