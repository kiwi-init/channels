// Retry opening a channel on a blip. Relative imports so bun test resolves them
// without the @mc alias.
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"

import { ChannelGone } from "../../../src/client.ts"

/**
 * Retry `open` on a blip (Unreachable, a generic relay error). ChannelGone is an
 * answer: this member is out. Interrupt (the view closed) is not retried.
 * `wait` is the first backoff in ms; it doubles, never more than 30s.
 */
export const untilOpen = <A, E, R>(open: Effect.Effect<A, E, R>, status: (line: string) => Effect.Effect<void>, wait = 500): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(open)
    if (Exit.isSuccess(exit)) return exit.value
    if (Cause.hasInterruptsOnly(exit.cause)) return yield* Effect.failCause(exit.cause)
    if (Cause.squash(exit.cause) instanceof ChannelGone) return yield* Effect.failCause(exit.cause)
    yield* status("can't reach the relay; still retrying")
    if (wait > 0) yield* Effect.sleep(`${wait} millis`)
    return yield* untilOpen(open, status, Math.min(wait * 2, 30_000))
  })
