import { Relay, fetchRelay, settle } from "@mc/client.ts"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { Storage, type StorageApi } from "@web/lib/storage"

export type Mobile = Storage | Relay

function memoryStore(): StorageApi {
  const kept = new Map<string, string>()
  return {
    get: (key) => Effect.sync(() => kept.get(key) ?? null),
    set: (key, value) => Effect.sync(() => void kept.set(key, value)),
    remove: (key) => Effect.sync(() => void kept.delete(key)),
  }
}

const MobileLive: Layer.Layer<Mobile> = Layer.mergeAll(Layer.succeed(Storage, memoryStore()), Layer.succeed(Relay, fetchRelay))

const runtime = ManagedRuntime.make(MobileLive)

export function run<A, E>(effect: Effect.Effect<A, E, Mobile>): Promise<A> {
  return runtime.runPromiseExit(effect).then(settle)
}

export function fork(effect: Effect.Effect<void, never, Mobile>): () => void {
  const fiber = runtime.runFork(effect)
  return () => void Effect.runFork(Fiber.interrupt(fiber))
}
