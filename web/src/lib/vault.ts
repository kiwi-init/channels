import { RelayError, Unreachable, reason } from "@mc/client.ts"
import { decodeJoinCode } from "@mc/crypto.ts"
import {
  PRF_SALT,
  VaultError,
  addWrap,
  fetchVault,
  forgetSeat,
  newRecoveryCode,
  newVault,
  openVault,
  putVault,
  recoverySecret,
  requestVaultReset,
  resealVault,
  rotateVault,
  seat,
  syncVault,
  unlock,
  vaultKey,
  wrapsOf,
  type OpenedVault,
  type PublicWrap,
  type VaultContents,
  type VaultKey,
  type WrapInput,
} from "@mc/vault.ts"
import * as Cause from "effect/Cause"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { useSyncExternalStore } from "react"

import { CHANGED, allMembers, forgetChannel, saveMember, type StoredMember } from "./channel"
import { createPasskey, touchPasskey } from "./passkey"
import { run } from "./runtime"
import { Storage } from "./storage"
import { freshSeats, reconcile } from "./vault-merge"
import { KeyStore } from "./vault-store"

// Your channels, kept for you at the relay where only your passkeys can open
// them. This browser pulls in every seat it doesn't have when the vault opens,
// and saves every seat it gains or leaves as it happens. The relay only ever
// holds ciphertext; the vault key stays in this browser (non-extractable) and
// in memory right after a touch, for adding or removing passkeys.
//
// Each step is an Effect over this browser's services (runtime.ts) that fails
// with what went wrong, by name: the errors below, the passkey's (passkey.ts),
// the relay's RelayError, IndexedDB's KeyStoreFailed. The exported functions run
// them for the page, which shows their text as it always has.

export type Wrap = PublicWrap

export type VaultState =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "none" }
  /** `resetAt`: someone asked to reset the vault; it's erased then unless a device that has it saves first. */
  | { kind: "locked"; wraps: Wrap[]; resetAt?: number }
  /** `cancelled`: this browser just stopped a reset someone asked for (when it was asked to happen). */
  | { kind: "open"; wraps: Wrap[]; cancelled?: number }
  | { kind: "error"; message: string }

interface Session {
  user: string
  email: string
  name: string
  token: () => Promise<string | null>
}

// ---------- what can go wrong ----------

/** No session to reach the vault with. */
export class SignInAgain extends Data.TaggedError("SignInAgain") {
  override get message(): string {
    return "sign in again to reach your vault"
  }
}

/** The step needs a vault, and there isn't one. */
export class NoVault extends Data.TaggedError("NoVault") {
  override get message(): string {
    return "there’s no vault yet"
  }
}

/** Setup found a vault already there: the page now offers to unlock it instead. */
export class VaultExists extends Data.TaggedError("VaultExists") {
  override get message(): string {
    return "You already have a vault for this account. Touch your passkey to unlock it, or use your recovery code."
  }
}

/** Setup's save didn't land, and there's still no vault. */
export class NotSaved extends Data.TaggedError("NotSaved") {
  override get message(): string {
    return "Your vault couldn’t be saved. Reload the page and try again."
  }
}

/** The passkey, or the recovery code, isn't one of this vault's. */
export class WrongKey extends Data.TaggedError("WrongKey")<{ readonly by: "passkey" | "code" }> {
  override get message(): string {
    return this.by === "passkey" ? "That passkey doesn’t open this vault." : "That recovery code doesn’t open this vault."
  }
}

/** What was typed isn't shaped like a recovery code. */
export class NotARecoveryCode extends Data.TaggedError("NotARecoveryCode") {
  override get message(): string {
    return "That isn’t a recovery code: it’s 32 letters and digits."
  }
}

/** Another device saved in between: read again and retry. */
export class VaultChanged extends Data.TaggedError("VaultChanged") {
  override get message(): string {
    return "Your vault changed on another device. Try again."
  }
}

/** Removing a passkey needs a touch of another one. */
export class SamePasskey extends Data.TaggedError("SamePasskey") {
  override get message(): string {
    return "Touch a different passkey than the one you’re removing."
  }
}

/** The vault itself refused (src/vault.ts): damaged, rolled back, sealed for someone else. Its own text. */
export class VaultBroken extends Data.TaggedError("VaultBroken")<{ readonly message: string }> {}

/** A call that reaches the relay: its refusals stay RelayError, the vault's are VaultBroken, and anything else is the relay out of reach. */
const atRelay = <A>(f: () => Promise<A>): Effect.Effect<A, RelayError | VaultBroken | Unreachable> =>
  Effect.tryPromise({
    try: f,
    catch: (e) => (e instanceof RelayError ? e : e instanceof VaultError ? new VaultBroken({ message: e.message }) : new Unreachable({ cause: e })),
  })

/** The vault's own crypto: its refusals are VaultBroken; anything else is a bug, not a step that failed. */
const sealed = <A>(f: () => Promise<A>): Effect.Effect<A, VaultBroken> =>
  Effect.tryPromise({ try: f, catch: (e) => e }).pipe(Effect.catch((e) => (e instanceof VaultError ? Effect.fail(new VaultBroken({ message: e.message })) : Effect.die(e))))

// ---------- the state the page shows ----------

let state: VaultState = { kind: "off" }
let session: Session | null = null
let key: VaultKey | null = null
/** The raw key, only between a touch and the page closing: adding a passkey needs it. */
let rawKey: string | null = null
/** The seats this browser last agreed with the vault on, to tell what changed since. */
let synced = new Set<string>()
const listeners = new Set<() => void>()

function set(next: VaultState) {
  state = next
  for (const l of listeners) l()
}

export function useVault(): VaultState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state
  )
}

// The highest version this browser has opened, so a relay can't quietly hand back an older vault.
const SEEN = (user: string) => `mc.vault.seen.${user}`
const seen = (user: string) => Effect.flatMap(Storage, (s) => Effect.map(s.get(SEEN(user)), (v) => Number(v ?? 0)))
const saw = (user: string, v: number) => Effect.flatMap(seen(user), (last) => (v > last ? Effect.flatMap(Storage, (s) => s.set(SEEN(user), String(v))) : Effect.void))

const token = Effect.suspend(() => {
  const s = session
  return s ? Effect.promise(() => s.token()) : Effect.succeed(null)
}).pipe(Effect.flatMap((t) => (t ? Effect.succeed(t) : Effect.fail(new SignInAgain()))))

/** The stored vault, or null when there's none. */
const stored = Effect.flatMap(token, (t) => atRelay(() => fetchVault(location.origin, t)))

const current = Effect.flatMap(stored, (got) => (got ? Effect.succeed(got) : Effect.fail(new NoVault())))

function wellFormed(m: StoredMember): boolean {
  try {
    return typeof m.identity?.pk === "string" && typeof m.identity.sk === "string" && typeof m.access?.ownerPk === "string" && decodeJoinCode(m.code).roomId === m.access.roomId
  } catch {
    return false
  }
}

/** A name for this browser's passkey, so the list says which one is which. */
function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "this device"
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "a browser"
  return `${browser} on ${os}`
}

const ids = (wraps: Wrap[]) => wraps.flatMap((w) => (w.credentialId ? [w.credentialId] : []))
const known = () => (state.kind === "locked" || state.kind === "open" ? state.wraps : [])
const lockedOn = (got: { blob: string; resetAt?: number }): VaultState => ({ kind: "locked", wraps: wrapsOf(got.blob), ...(got.resetAt ? { resetAt: got.resetAt } : {}) })

/** Make this browser agree with the vault (see reconcile). Returns how many channels came in. */
function take(c: VaultContents<StoredMember>): number {
  const { drop, add } = reconcile(allMembers(), c)
  for (const code of drop) forgetChannel(code)
  let added = 0
  for (const m of add) {
    if (!wellFormed(m)) continue
    try {
      saveMember({ ...m, at: m.at || Date.now() })
      added++
    } catch {
      // Held here under another live key: this browser's own key wins, and merge reports the conflict.
    }
  }
  synced = new Set(c.channels.map(seat))
  return added
}

// ---------- the steps ----------

/**
 * Open the vault with a key: cancel any pending reset (only someone without a
 * device that has the vault asks for one, so from here it's never wanted
 * silently), pull, then push whatever this browser had that the vault didn't.
 */
const opened = Effect.fn("vault.opened")(function* (got: { version: number; blob: string; resetAt?: number }, k: VaultKey) {
  const s = session!
  const highest = yield* seen(s.user)
  const v = yield* sealed(() => openVault<StoredMember>(got.blob, s.user, k, got.version, highest))
  yield* saw(s.user, got.version)
  key = k
  let cancelled: number | undefined
  if (got.resetAt) {
    const t = yield* token
    const blob = yield* sealed(() => resealVault(got.blob, s.user, k, v, got.version + 1, v))
    const r = yield* atRelay(() => putVault(location.origin, t, s.user, got.version, blob, v.writer))
    if ("version" in r) {
      yield* saw(s.user, r.version)
      cancelled = got.resetAt
    }
  }
  const added = take(v)
  set({ kind: "open", wraps: v.wraps, ...(cancelled ? { cancelled } : {}) })
  yield* push
  return added
})

/** Find the vault for whoever just signed in, and open it with the key this browser kept, if it still does. */
const load = Effect.fn("vault.load")(function* (user: string) {
  const keys = yield* KeyStore
  const got = yield* stored
  if (!got) return set({ kind: "none" })
  const kept = yield* keys.load(user)
  if (kept) {
    // The vault was rotated elsewhere (a passkey removed): this browser's key no longer opens it.
    const ok = yield* opened(got, kept).pipe(
      Effect.as(true),
      Effect.catchCause(() => Effect.as(keys.forget(user), false))
    )
    if (ok) return
  }
  set(lockedOn(got))
})

/** Start (or stop) the vault for whoever is signed in. */
export async function startVault(next: Session | null): Promise<void> {
  if (next?.user === session?.user) return
  session = next
  key = rawKey = null
  synced = new Set()
  if (!next) return set({ kind: "off" })
  set({ kind: "loading" })
  await run(load(next.user).pipe(Effect.catchCause((cause) => Effect.sync(() => set({ kind: "error", message: reason(Cause.squash(cause)) })))))
}

/** Show the vault that's there as locked, and say so. */
const alreadyThere = Effect.gen(function* () {
  const t = yield* token
  const got = yield* atRelay(() => fetchVault(location.origin, t)).pipe(Effect.catchCause(() => Effect.succeed(null)))
  if (!got) return yield* new NotSaved()
  set(lockedOn(got))
  return yield* new VaultExists()
})

/** First time: make a passkey, put every channel this browser has in a new vault. Returns the recovery code to show once. */
const setUp = Effect.fn("vault.setUp")(function* () {
  const s = session!
  // A vault may exist already (another device, or an earlier try here that didn't finish): unlock it, and don't make a passkey for nothing.
  if (yield* stored) return yield* alreadyThere
  // The WebAuthn user handle is the WorkOS user id: stable, and not personal data.
  const pk = yield* createPasskey({ id: s.user, name: s.email || s.name, displayName: s.name }, PRF_SALT)
  const contents: VaultContents<StoredMember> = { channels: allMembers(), gone: {} }
  const made = yield* sealed(() => newVault(s.user, contents, { kind: "passkey", label: deviceLabel(), secret: pk.secret, credentialId: pk.credentialId }))
  const first = yield* sealed(() => openVault<StoredMember>(made.blob, s.user, made.key, 1))
  const code = newRecoveryCode()
  const blob = yield* sealed(() => addWrap(made.blob, s.user, made.key, first, 1, { kind: "recovery", label: "Recovery code", secret: recoverySecret(code)! }))
  // Another save got there first (409, or 403 from a relay that checks the signer before the version): there's a vault now.
  const t = yield* token
  const r = yield* atRelay(() => putVault(location.origin, t, s.user, 0, blob, made.writer, made.writer.pk)).pipe(Effect.catchCause(() => alreadyThere))
  if ("conflict" in r) return yield* alreadyThere
  yield* saw(s.user, r.version)
  // Saved. From here a hiccup in this browser must not leave the page offering setup again.
  rawKey = made.key
  key = made.key
  synced = new Set(contents.channels.map(seat))
  set({ kind: "open", wraps: wrapsOf(blob) })
  yield* Effect.gen(function* () {
    key = yield* sealed(() => vaultKey(made.key))
    yield* (yield* KeyStore).keep(s.user, key)
  }).pipe(
    // Without IndexedDB this browser syncs until it closes, then asks for the passkey again.
    Effect.catchCause((cause) => Effect.sync(() => console.warn("vault: key not kept in this browser", Cause.squash(cause))))
  )
  return code
})

export const setUpVault = (): Promise<string> => run(setUp())

const unlockWith = Effect.fn("vault.unlockWith")(function* (secret: Uint8Array, credentialId?: string) {
  const s = session!
  const got = yield* current
  const raw = yield* sealed(() => unlock(got.blob, s.user, secret, credentialId))
  if (!raw) return yield* new WrongKey({ by: credentialId ? "passkey" : "code" })
  rawKey = raw
  const k = yield* sealed(() => vaultKey(raw))
  yield* (yield* KeyStore).keep(s.user, k)
  return yield* opened(got, k)
})

/** Touch any of the vault's passkeys. Returns how many channels came in. */
export const unlockWithPasskey = (): Promise<number> => run(Effect.flatMap(touchPasskey(PRF_SALT, ids(known())), (pk) => unlockWith(pk.secret, pk.credentialId)))

export const unlockWithCode = (code: string): Promise<number> =>
  run(
    Effect.gen(function* () {
      const secret = recoverySecret(code)
      if (!secret) return yield* new NotARecoveryCode()
      return yield* unlockWith(secret)
    })
  )

/**
 * Lost every passkey and the recovery code, or the vault wasn't made with
 * yours: ask for a reset. It waits a day, and any device that still opens the
 * vault cancels it, so a stolen sign-in can't erase it quietly.
 */
export const resetVault = (): Promise<number> =>
  run(
    Effect.gen(function* () {
      const t = yield* token
      const { resetAt } = yield* atRelay(() => requestVaultReset(location.origin, t))
      if (state.kind === "locked") set({ ...state, resetAt })
      return resetAt
    })
  )

/** The warning about a cancelled reset has been read. */
export function dismissCancelled() {
  if (state.kind === "open" && state.cancelled) set({ kind: "open", wraps: state.wraps })
}

/** Save what changed in this browser since the vault last saw it: seats gained, seats left. */
const push = Effect.suspend(() => {
  const k = key
  const s = session
  if (!k || !s) return Effect.void
  const mine = new Map(allMembers().map((m) => [seat(m), m]))
  const added = [...mine.keys()].filter((x) => !synced.has(x))
  const left = [...synced].filter((x) => !mine.has(x))
  if (!added.length && !left.length) return Effect.void
  const change = (c: VaultContents<StoredMember>): VaultContents<StoredMember> => {
    let next: VaultContents<StoredMember> = { channels: c.channels, gone: c.gone }
    for (const x of left) {
      const [code, pk] = x.split(" ")
      next = forgetSeat(next, { code: code!, identity: { pk: pk! } })
    }
    // Never bring back a seat the vault has tombstoned: another device left it, or it was taken over.
    return {
      ...next,
      channels: [
        ...next.channels,
        ...freshSeats(
          added.map((x) => mine.get(x)!),
          next
        ),
      ],
    }
  }
  return Effect.gen(function* () {
    const t = yield* token
    const highest = yield* seen(s.user)
    const r = yield* atRelay(() => syncVault<StoredMember>(location.origin, t, s.user, k, change, highest))
    yield* saw(s.user, r.version)
    take(r.contents)
  })
})

/**
 * Signing out locks the vault in this browser: the key kept for syncing is
 * forgotten, so whoever signs in here next needs a passkey or the recovery code.
 */
export async function lockVault(): Promise<void> {
  const user = session?.user
  key = rawKey = null
  synced = new Set()
  session = null
  set({ kind: "off" })
  if (user) await run(Effect.flatMap(KeyStore, (keys) => keys.forget(user)))
}

let timer: ReturnType<typeof setTimeout> | undefined
window.addEventListener(CHANGED, () => {
  if (state.kind !== "open") return
  clearTimeout(timer)
  timer = setTimeout(() => void run(push).catch((err) => console.warn("vault: not saved", err)), 400)
})

/** Adding or removing a passkey needs the raw key, which only a fresh touch gives. */
const freshKey = Effect.gen(function* () {
  const pk = yield* touchPasskey(PRF_SALT, ids(known()))
  const got = yield* current
  const raw = yield* sealed(() => unlock(got.blob, session!.user, pk.secret, pk.credentialId))
  if (!raw) return yield* new WrongKey({ by: "passkey" })
  const label = known().find((w) => w.credentialId === pk.credentialId)?.label || deviceLabel()
  const keep: WrapInput = { kind: "passkey", label, secret: pk.secret, credentialId: pk.credentialId }
  return { raw, keep }
})

const openNow = (k: VaultKey) =>
  Effect.gen(function* () {
    const got = yield* current
    const highest = yield* seen(session!.user)
    const v: OpenedVault<StoredMember> = yield* sealed(() => openVault<StoredMember>(got.blob, session!.user, k, got.version, highest))
    return { got, v }
  })

/** Another passkey that opens the same vault: a phone, a security key. */
export const addPasskey = (): Promise<void> =>
  run(
    Effect.gen(function* () {
      const s = session!
      const raw = rawKey ?? (yield* freshKey).raw
      const pk = yield* createPasskey({ id: s.user, name: s.email || s.name, displayName: s.name }, PRF_SALT, ids(known()))
      const { got, v } = yield* openNow(raw)
      const blob = yield* sealed(() => addWrap(got.blob, s.user, raw, v, got.version + 1, { kind: "passkey", label: deviceLabel(), secret: pk.secret, credentialId: pk.credentialId }))
      const t = yield* token
      const r = yield* atRelay(() => putVault(location.origin, t, s.user, got.version, blob, v.writer))
      if ("conflict" in r) return yield* new VaultChanged()
      yield* saw(s.user, r.version)
      rawKey = raw
      const now = yield* sealed(() => openVault(blob, s.user, raw, r.version))
      set({ kind: "open", wraps: now.wraps })
    })
  )

/**
 * Remove a passkey for real: a new vault key, opened by the passkey touched
 * here and a new recovery code. Other passkeys stop working until they're
 * added again. Returns the new recovery code.
 */
export const removePasskey = (w: Wrap): Promise<string> =>
  run(
    Effect.gen(function* () {
      const s = session!
      const { keep } = yield* freshKey
      if (keep.credentialId === w.credentialId) return yield* new SamePasskey()
      const { got, v } = yield* openNow(key!)
      const next = yield* sealed(() => rotateVault(s.user, v, got.version + 1, keep))
      const t = yield* token
      const r = yield* atRelay(() => putVault(location.origin, t, s.user, got.version, next.blob, v.writer, next.writer.pk))
      if ("conflict" in r) return yield* new VaultChanged()
      yield* saw(s.user, r.version)
      rawKey = next.key
      key = yield* sealed(() => vaultKey(next.key))
      yield* (yield* KeyStore).keep(s.user, key)
      const now = yield* sealed(() => openVault(next.blob, s.user, next.key, r.version))
      set({ kind: "open", wraps: now.wraps })
      return next.recoveryCode
    })
  )

