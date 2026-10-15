import { keepRecordsIn } from "@mc/client.ts"
import { generateIdentity } from "@mc/identity.ts"
import type { Member } from "@mc/membership.ts"
import type { Signed, SigningBudget } from "@mc/sas.ts"

import type { ChannelIdentityView, ChannelOps, ComputerView, PendingItem, PersonView } from "../../../desktop/src/bridge.ts"
import { Keyring } from "../../../desktop/src/keyring.ts"
import { acceptSeat, withAccess } from "../../../desktop/src/seats.ts"
import { personClaimFor } from "./person-claim"
import { relayUrl } from "./relay"

export interface Local {
  person: PersonView | null
  channels: ChannelIdentityView[]
  computers: ComputerView[]
  pending: PendingItem[]
}

const LOCAL_KEY = "kiwi.secrets"
const listeners = new Set<(l: Local) => void>()

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null
  } catch {
    return null
  }
}

export function readLocal(): Local {
  const v = read<Partial<Local>>(LOCAL_KEY)
  return { person: v?.person ?? null, channels: v?.channels ?? [], computers: v?.computers ?? [], pending: v?.pending ?? [] }
}

export function writeLocal(patch: Partial<Local>): Local {
  const next = { ...readLocal(), ...patch }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(next))
  for (const l of listeners) l(next)
  return next
}

export function onLocalChange(cb: (l: Local) => void): void {
  listeners.add(cb)
}

export async function makeLocalPerson(name: string): Promise<PersonView> {
  const id = await generateIdentity(name)
  if (!id.xpk || !id.xsk) throw new Error("the person key has no exchange key")
  const p: PersonView = { name: id.name, pk: id.pk, sk: id.sk, xpk: id.xpk, xsk: id.xsk }
  writeLocal({ person: p })
  return p
}

const budget: SigningBudget = {
  load: (roomId) => {
    const t = read<unknown>(`mc.checks.${roomId}`)
    return Array.isArray(t) ? (t as Signed[]) : []
  },
  save: (roomId, signed) => {
    try {
      localStorage.setItem(`mc.checks.${roomId}`, JSON.stringify(signed))
    } catch {
      return
    }
  },
}

export function localOps(): ChannelOps {
  keepRecordsIn({
    get: (room, pk) => read<Member>(`mc.rec.${room}.${pk}`),
    set: (room, pk, m) => localStorage.setItem(`mc.rec.${room}.${pk}`, JSON.stringify(m)),
  })
  const seats = () => readLocal().channels
  return new Keyring({
    relay: relayUrl,
    seats,
    save: async (entry) => void writeLocal({ channels: acceptSeat(seats(), entry) }),
    access: async (code, pk, access) => void writeLocal({ channels: withAccess(seats(), code, pk, access) }),
    forget: async (code) => void writeLocal({ channels: seats().filter((c) => c.code !== code) }),
    prove: async (code, memberPk) => {
      const p = readLocal().person
      return p ? personClaimFor(p, code, memberPk) : null
    },
    budget,
  })
}
