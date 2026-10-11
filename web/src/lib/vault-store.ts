// Where this browser keeps the vault key between visits: IndexedDB, as a
// non-extractable CryptoKey, so page script can use it to sync but never read
// it out. One record per signed-in person.

import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"

const DB = "mc.vault"
const STORE = "keys"

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

/** Keep a copy of the vault key that can sync but can't be exported. */
export async function keepVaultKey(user: string, key: CryptoKey): Promise<void> {
  // vaultKey() already makes it non-extractable, and exporting one throws: store it as it is.
  // Only an extractable key (none today) is re-imported first, so what's kept can never be read out.
  const locked = key.extractable ? await crypto.subtle.importKey("raw", await crypto.subtle.exportKey("raw", key), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]) : key
  await run("readwrite", (s) => s.put(locked, user))
}

export async function loadVaultKey(user: string): Promise<CryptoKey | null> {
  return ((await run("readonly", (s) => s.get(user))) as CryptoKey | undefined) ?? null
}

export async function forgetVaultKey(user: string): Promise<void> {
  await run("readwrite", (s) => s.delete(user))
}

// ---------- the same, as a service ----------

/** IndexedDB refused (private mode, a blocked or broken database): the text is the browser's. */
export class KeyStoreFailed extends Data.TaggedError("KeyStoreFailed")<{ readonly cause: unknown }> {
  override get message(): string {
    return this.cause instanceof Error ? this.cause.message : String(this.cause)
  }
}

export interface KeyStoreApi {
  readonly keep: (user: string, key: CryptoKey) => Effect.Effect<void, KeyStoreFailed>
  readonly load: (user: string) => Effect.Effect<CryptoKey | null, KeyStoreFailed>
  readonly forget: (user: string) => Effect.Effect<void, KeyStoreFailed>
}

/** Where the vault key is kept between visits. */
export class KeyStore extends Context.Service<KeyStore, KeyStoreApi>()("kiwi/web/KeyStore") {}

const attempt = <A>(f: () => Promise<A>) => Effect.tryPromise({ try: f, catch: (cause) => new KeyStoreFailed({ cause }) })

/** This browser's IndexedDB: the functions above. */
export const indexedKeys: KeyStoreApi = {
  keep: (user, key) => attempt(() => keepVaultKey(user, key)),
  load: (user) => attempt(() => loadVaultKey(user)),
  forget: (user) => attempt(() => forgetVaultKey(user)),
}
