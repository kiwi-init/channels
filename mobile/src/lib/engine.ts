import { Channel, type PresenceFields } from "@mc/client.ts"
import type { SigningBudget } from "@mc/sas.ts"
import { generateIdentity, type Identity } from "@mc/identity.ts"
import type { ChannelView, JoinCheck, PersonView } from "../../../desktop/src/bridge.ts"
import { Keyring } from "../../../desktop/src/keyring.ts"
import { acceptSeat, channelAccess, withAccess } from "../../../desktop/src/seats.ts"
import { personClaimFor } from "@web/lib/person-claim"

import { relayUrl } from "./relay"
import type { ChannelIdentityView, Secrets } from "./secrets"

export interface Engine {
  person(): PersonView | null
  seats(): readonly ChannelIdentityView[]
  joined(): readonly ChannelIdentityView[]
  waiting(): readonly ChannelIdentityView[]
  subscribe(listener: () => void): () => void
  load(): Promise<void>
  createPerson(name: string): Promise<PersonView>
  adopt(person: PersonView, channels: readonly ChannelIdentityView[]): Promise<void>
  requestJoin(code: string, name?: string): Promise<ChannelView>
  createChannel(name: string): Promise<string>
  checkJoin(code: string): Promise<JoinCheck>
  channel(code: string): Channel | null
  forget(code: string): Promise<void>
  presence(code: string, fields: PresenceFields): Promise<void>
}

const identityOf = (person: PersonView): Identity => ({ name: person.name, pk: person.pk, sk: person.sk, xpk: person.xpk, xsk: person.xsk })

const memberIdentity = (seat: ChannelIdentityView): Identity => ({
  name: seat.idName ?? seat.label,
  pk: seat.pk,
  sk: seat.sk,
  ...(seat.xpk ? { xpk: seat.xpk } : {}),
  ...(seat.xsk ? { xsk: seat.xsk } : {}),
})

export function createEngine(secrets: Secrets, relay: () => string = relayUrl): Engine {
  let person: PersonView | null = null
  let seats: ChannelIdentityView[] = []
  const listeners = new Set<() => void>()
  const open = new Map<string, Channel>()
  const checks = new Map<string, unknown>()

  const budget: SigningBudget = {
    load: (roomId) => (Array.isArray(checks.get(roomId)) ? (checks.get(roomId) as never[]) : []),
    save: (roomId, signed) => void checks.set(roomId, signed),
  }

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const persist = async (next: ChannelIdentityView[], changed?: ChannelIdentityView) => {
    const removed = seats.filter((old) => !next.some((entry) => entry.code === old.code && entry.pk === old.pk))
    seats = next
    for (const gone of removed) await secrets.removeChannel(gone.code || gone.pk)
    if (changed) await secrets.saveChannel(changed)
    emit()
  }

  const keyring = new Keyring({
    relay,
    seats: () => seats,
    save: async (entry) => persist(acceptSeat(seats, entry), entry),
    access: async (code, pk, access) => {
      const next = withAccess(seats, code, pk, access)
      await persist(
        next,
        next.find((seat) => seat.code === code && seat.pk === pk)
      )
    },
    forget: async (code) => {
      await persist(seats.filter((seat) => seat.code !== code))
    },
    prove: async (code, memberPk) => (person ? personClaimFor(identityOf(person), code, memberPk) : null),
    person: () => person?.pk ?? null,
    budget,
  })

  return {
    person: () => person,
    seats: () => seats,
    joined: () => seats.filter((seat) => !!seat.access),
    waiting: () => seats.filter((seat) => !seat.access),
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    async load() {
      person = await secrets.loadPerson()
      seats = await secrets.loadChannels()
      emit()
    },
    async createPerson(name) {
      const id = await generateIdentity(name)
      if (!id.xpk || !id.xsk) throw new Error("the person key has no exchange key")
      const made: PersonView = { name: id.name, pk: id.pk, sk: id.sk, xpk: id.xpk, xsk: id.xsk }
      await secrets.savePerson(made)
      person = made
      emit()
      return made
    },
    async adopt(next, entries) {
      await secrets.savePerson(next)
      for (const entry of entries) await secrets.saveChannel(entry)
      person = next
      seats = [...seats.filter((seat) => !entries.some((entry) => entry.code === seat.code && entry.pk === seat.pk)), ...entries]
      emit()
    },
    requestJoin(code, name) {
      if (!person) throw new Error("make your person key first")
      return keyring.requestJoin(code, name ?? person.name)
    },
    async createChannel(name) {
      if (!person) throw new Error("make your person key first")
      const made = await keyring.create(name, null, { name: person.name })
      return made.code ?? ""
    },
    checkJoin: (code) => keyring.joinStatus(code),
    channel(code) {
      const seat = seats.find((entry) => entry.code === code && entry.access)
      const access = seat ? channelAccess(seat) : null
      if (!seat || !access) return null
      const key = `${code}\n${seat.pk}`
      const had = open.get(key)
      if (had && had.relay === relay()) {
        if (access.epoch > had.access.epoch) had.access = { ...had.access, ...access, keys: { ...had.access.keys, ...access.keys } }
        return had
      }
      const channel = new Channel(access, relay(), memberIdentity(seat), (next) => {
        const merged = withAccess(seats, code, seat.pk, next)
        void persist(
          merged,
          merged.find((entry) => entry.code === code && entry.pk === seat.pk)
        ).catch(() => {})
      })
      open.set(key, channel)
      return channel
    },
    async forget(code) {
      for (const key of [...open.keys()]) if (key.startsWith(`${code}\n`)) open.delete(key)
      await keyring.forget(code)
    },
    presence: (code, fields) => keyring.presence(code, fields),
  }
}
