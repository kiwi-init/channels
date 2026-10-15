import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

// This browser's localStorage, as the Effect code reaches it. Same keys, same
// values. What render reads synchronously (membership, the channel list) stays
// plain calls in channel.ts; this is the same storage, as a service a test can
// stand in for.

/** The browser refused a write: private mode, or a full disk. */
class StorageRefused extends Data.TaggedError("StorageRefused")<{ readonly cause: unknown }> {
  override get message(): string {
    return this.cause instanceof Error ? this.cause.message : String(this.cause)
  }
}

export interface StorageApi {
  readonly get: (key: string) => Effect.Effect<string | null>
  readonly set: (key: string, value: string) => Effect.Effect<void, StorageRefused>
  readonly remove: (key: string) => Effect.Effect<void>
}

export class Storage extends Context.Service<Storage, StorageApi>()("kiwi/web/Storage") {}

/** window.localStorage. */
export const localStore: StorageApi = {
  get: (key) => Effect.sync(() => localStorage.getItem(key)),
  set: (key, value) => Effect.try({ try: () => localStorage.setItem(key, value), catch: (cause) => new StorageRefused({ cause }) }),
  remove: (key) => Effect.sync(() => localStorage.removeItem(key)),
}
