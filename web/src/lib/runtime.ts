import { Relay, fetchRelay, settle } from "@mc/client.ts"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"

import { Storage, localStore } from "./storage"

// The dashboard on Effect (docs/plans/effect.md, "The web"): React stays at the
// edge. What a component starts runs here, on one runtime with this browser's
// services: its storage and the relay over HTTP. (The person's secrets live behind the
// desktop bridge: lib/secrets.ts.)
// A step that fails rejects with its typed error (an Error, with the text the
// page has always shown), so a component branches on the tag, never the text.

/** What the dashboard's Effects run with. */
export type Web = Storage | Relay

/** This browser's services. */
export const WebLive: Layer.Layer<Web> = Layer.mergeAll(Layer.succeed(Storage, localStore), Layer.succeed(Relay, fetchRelay))

const runtime = ManagedRuntime.make(WebLive)

/**
 * Run a step for a component: its value, or a rejection with what it failed
 * with (what fetch threw, for a relay out of reach, as the Promise methods do).
 */
export function run<A, E>(effect: Effect.Effect<A, E, Web>): Promise<A> {
  return runtime.runPromiseExit(effect).then(settle)
}

/**
 * Start something that runs until it's stopped (a channel's live stream): the
 * returned function stops it, which is what a React effect's cleanup calls. It
 * handles its own failures: nobody is waiting on it to hear them.
 */
export function fork(effect: Effect.Effect<void, never, Web>): () => void {
  const fiber = runtime.runFork(effect)
  return () => void Effect.runFork(Fiber.interrupt(fiber))
}
