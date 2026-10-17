import { describe, expect, test } from "bun:test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"

import { ChannelGone, Unreachable } from "@kiwi/core/client.ts"

import { untilOpen } from "./until-open"

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe("untilOpen", () => {
  test("retries Unreachable then succeeds", async () => {
    let n = 0
    const status: string[] = []
    const open = Effect.suspend(() => {
      n++
      return n < 3 ? Effect.fail(new Unreachable({ cause: new Error("blip") })) : Effect.succeed(42)
    })
    expect(await run(untilOpen(open, (line) => Effect.sync(() => void status.push(line)), 0))).toBe(42)
    expect(n).toBe(3)
    expect(status).toEqual(["can't reach the relay; still retrying", "can't reach the relay; still retrying"])
  })

  test("a generic Error is a blip too", async () => {
    let n = 0
    const open = Effect.suspend(() => {
      n++
      return n === 1 ? Effect.fail(new Error("502")) : Effect.succeed("ok")
    })
    expect(await run(untilOpen(open, () => Effect.void, 0))).toBe("ok")
    expect(n).toBe(2)
  })

  test("ChannelGone is not retried", async () => {
    let n = 0
    const status: string[] = []
    const open = Effect.suspend(() => {
      n++
      return Effect.fail(new ChannelGone("removed"))
    })
    const err = await run(untilOpen(open, (line) => Effect.sync(() => void status.push(line)), 0).pipe(Effect.flip))
    expect(err).toBeInstanceOf(ChannelGone)
    expect(n).toBe(1)
    expect(status).toEqual([])
  })

  test("interrupt is not retried", async () => {
    let n = 0
    const open = Effect.suspend(() => {
      n++
      return Effect.interrupt
    })
    const fiber = Effect.runFork(untilOpen(open, () => Effect.void, 0))
    const exit = await Effect.runPromise(Fiber.await(fiber))
    expect(Cause.hasInterruptsOnly(exit._tag === "Failure" ? exit.cause : Cause.die("ok"))).toBe(true)
    expect(n).toBe(1)
  })
})
