import { keepRecordsIn } from "@kiwi/core/client/info.ts"
import { generateIdentity } from "@kiwi/core/identity.ts"
import type { Member } from "@kiwi/core/membership.ts"
import type { Signed, SigningBudget } from "@kiwi/core/sas.ts"

import type { ChannelOps, PersonView } from "../../../desktop/src/bridge.ts"
import { Keyring } from "../../../desktop/src/keyring.ts"
import { read, readLocal, writeLocal } from "./local-store"
import { personClaimFor } from "./person-claim"
import { relayUrl } from "./relay"

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
  const keyring = new Keyring({
    relay: relayUrl,
    seats,
    save: async (entry) => {
      const { acceptSeat } = await import("../../../desktop/src/seats.ts")
      writeLocal({ channels: acceptSeat(seats(), entry) })
    },
    access: async (code, pk, access) => {
      const { withAccess } = await import("../../../desktop/src/seats.ts")
      writeLocal({ channels: withAccess(seats(), code, pk, access) })
    },
    forget: async (code) => void writeLocal({ channels: seats().filter((c) => c.code !== code) }),
    prove: async (code, memberPk) => {
      const p = readLocal().person
      return p ? { person: await personClaimFor(p, code, memberPk) } : null
    },
    githubToken: async () => null,
    person: () => readLocal().person?.pk ?? null,
    mine: () => null,
    budget,
  })
  void keyring.finishCreating().catch(() => {})
  return keyring
}
