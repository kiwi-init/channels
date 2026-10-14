// The person's secrets: their person key, their paired computers and the join requests waiting
// on them. In the desktop app they live behind the bridge (window.kiwi), which keeps them with the
// OS keychain (safeStorage) and hands the renderer one synchronous snapshot at load. In a plain
// browser (development) they fall back to localStorage, so the renderer runs the same either way.

import { useSyncExternalStore } from "react"

import { generateIdentity } from "@mc/identity.ts"
import type { PersonClaim } from "@mc/person.ts"

import type { ChannelIdentityView, ComputerView, KiwiBridge, PairAskView, PendingItem, PersonView, PublicPerson, StoreSnapshot, UpdateView } from "../../../desktop/src/bridge.ts"
import { personClaimFor } from "./person-claim"
import { persistQueue } from "./persist-queue"

export type { ChannelIdentityView, ComputerView, KiwiBridge, PairAskView, PendingItem, PersonView, PublicPerson, StoreSnapshot, UpdateView }

/** The desktop bridge, or null in a plain browser. */
export function bridge(): KiwiBridge | null {
  try {
    const k = (window as unknown as { kiwi?: KiwiBridge }).kiwi
    return k && typeof k.getSnapshot === "function" ? k : null
  } catch {
    return null
  }
}

const LOCAL_KEY = "kiwi.secrets"
type Local = Omit<StoreSnapshot, "relayUrl" | "person"> & { person: PersonView | null }

function readLocal(): Local {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "null") as Partial<Local> | null
    return { person: v?.person ?? null, channels: v?.channels ?? [], computers: v?.computers ?? [], pending: v?.pending ?? [] }
  } catch {
    return { person: null, channels: [], computers: [], pending: [] }
  }
}

let snapshot: StoreSnapshot = (() => {
  const b = bridge()
  return b ? b.getSnapshot() : { relayUrl: "", ...readLocal() }
})()
const listeners = new Set<() => void>()
function publish(next: StoreSnapshot) {
  snapshot = next
  for (const l of listeners) l()
}
bridge()?.onStore(publish)

function writeLocal(patch: Partial<Local>) {
  const next = { ...snapshot, ...patch }
  const local: Local = { person: patch.person ?? readLocal().person, channels: next.channels, computers: next.computers, pending: next.pending }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(local))
  publish(next)
}

/** What's kept right now. */
export const secrets = (): StoreSnapshot => snapshot

/** The same, as React state. */
export function useSecrets(): StoreSnapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snapshot
  )
}

/** First run: make the person key under `name` and keep it. */
export async function createPerson(name: string): Promise<PublicPerson> {
  const b = bridge()
  if (b) {
    const p = await b.createPerson(name)
    publish({ ...snapshot, person: p })
    return p
  }
  const id = await generateIdentity(name)
  const p: PersonView = { name: id.name, pk: id.pk, sk: id.sk, xpk: id.xpk!, xsk: id.xsk! }
  writeLocal({ person: p })
  return p
}

export async function personClaim(code: string, memberPk: string): Promise<PersonClaim | null> {
  const b = bridge()
  if (b) return snapshot.person ? b.provePerson(code, memberPk) : null
  const local = readLocal().person
  return local ? personClaimFor(local, code, memberPk) : null
}

const persistChannels = persistQueue()

/** Keep the channel identities (member keys, pending joins). Visible at once; the write follows, one at a time. */
export async function saveChannels(channels: ChannelIdentityView[]): Promise<void> {
  const b = bridge()
  if (b) {
    publish({ ...snapshot, channels })
    await persistChannels(() => b.saveChannels(channels))
  } else writeLocal({ channels })
}

export async function saveComputers(computers: ComputerView[]): Promise<void> {
  const b = bridge()
  if (b) {
    await b.saveComputers(computers)
    publish({ ...snapshot, computers })
  } else writeLocal({ computers })
}

export async function setPending(pending: PendingItem[]): Promise<void> {
  const b = bridge()
  if (b) {
    await b.setPending(pending)
    publish({ ...snapshot, pending })
  } else writeLocal({ pending })
}
