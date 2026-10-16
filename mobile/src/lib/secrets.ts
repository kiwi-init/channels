import type { ChannelIdentityView, PersonView } from "../../../desktop/src/bridge.ts"

export type { ChannelIdentityView }

export interface SecureKV {
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(key: string, value: string): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

export interface Secrets {
  loadPerson(): Promise<PersonView | null>
  savePerson(person: PersonView): Promise<void>
  removePerson(): Promise<void>
  loadChannels(): Promise<ChannelIdentityView[]>
  saveChannel(channel: ChannelIdentityView): Promise<void>
  removeChannel(id: string): Promise<void>
}

const PERSON = "kiwi.person"
const CHANNELS = "kiwi.channels"

const entryKey = (id: string): string => `kiwi.channel.${id}`

export function channelId(channel: ChannelIdentityView): string {
  return channel.code || channel.pk
}

async function read<T>(kv: SecureKV, key: string): Promise<T | null> {
  const raw = await kv.getItemAsync(key)
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function listed(kv: SecureKV): Promise<string[]> {
  const found = await read<unknown>(kv, CHANNELS)
  return Array.isArray(found) ? found.filter((id): id is string => typeof id === "string") : []
}

export function secureSecrets(kv: SecureKV): Secrets {
  const ids = (): Promise<string[]> => listed(kv)
  return {
    loadPerson: () => read<PersonView>(kv, PERSON),
    savePerson: (person) => kv.setItemAsync(PERSON, JSON.stringify(person)),
    removePerson: () => kv.deleteItemAsync(PERSON),
    loadChannels: async () => {
      const out: ChannelIdentityView[] = []
      for (const id of await ids()) {
        const found = await read<ChannelIdentityView>(kv, entryKey(id))
        if (found) out.push(found)
      }
      return out
    },
    saveChannel: async (channel) => {
      const id = channelId(channel)
      await kv.setItemAsync(entryKey(id), JSON.stringify(channel))
      const known = await ids()
      if (!known.includes(id)) await kv.setItemAsync(CHANNELS, JSON.stringify([...known, id]))
    },
    removeChannel: async (id) => {
      await kv.deleteItemAsync(entryKey(id))
      const keep = (await ids()).filter((known) => known !== id)
      if (keep.length) await kv.setItemAsync(CHANNELS, JSON.stringify(keep))
      else await kv.deleteItemAsync(CHANNELS)
    },
  }
}
