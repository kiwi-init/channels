import type { ChannelIdentityView, PersonView } from "../../../desktop/src/bridge.ts"

import { channelId, secureSecrets, type SecureKV } from "./secrets"

interface Fake extends SecureKV {
  items: Record<string, string>
}

function fakeStore(seed: Record<string, string> = {}): Fake {
  const items = { ...seed }
  return {
    items,
    getItemAsync: async (key) => items[key] ?? null,
    setItemAsync: async (key, value) => {
      items[key] = value
    },
    deleteItemAsync: async (key) => {
      delete items[key]
    },
  }
}

const person: PersonView = { name: "jow", pk: "pk-person", sk: "sk-person", xpk: "xpk-person", xsk: "xsk-person" }

const dev: ChannelIdentityView = {
  label: "channels-dev",
  pk: "pk-dev",
  sk: "sk-dev",
  xpk: "xpk-dev",
  xsk: "xsk-dev",
  roomId: "room-dev",
  code: "mc2-dev",
  idName: "jow",
  access: { roomId: "room-dev", ownerPk: "pk-owner", ownerXpk: "xpk-owner", epoch: 1 },
}

const other: ChannelIdentityView = { label: "onemouse", pk: "pk-other", sk: "sk-other", code: "mc2-other" }

const imported: ChannelIdentityView = { label: "old", pk: "pk-imported", sk: "sk-imported", imported: true }

describe("mobile secrets", () => {
  it("round-trips the person key", async () => {
    const kv = fakeStore()
    const secrets = secureSecrets(kv)

    expect(await secrets.loadPerson()).toBeNull()
    await secrets.savePerson(person)
    expect(await secrets.loadPerson()).toEqual(person)
    await secrets.removePerson()
    expect(await secrets.loadPerson()).toBeNull()
    expect(Object.keys(kv.items)).toEqual([])
  })

  it("round-trips channel keys, in the order they were saved", async () => {
    const kv = fakeStore()
    const secrets = secureSecrets(kv)

    expect(await secrets.loadChannels()).toEqual([])
    await secrets.saveChannel(dev)
    await secrets.saveChannel(other)
    expect(await secrets.loadChannels()).toEqual([dev, other])

    await secrets.removeChannel(channelId(dev))
    expect(await secrets.loadChannels()).toEqual([other])

    await secrets.removeChannel(channelId(other))
    expect(await secrets.loadChannels()).toEqual([])
    expect(Object.keys(kv.items)).toEqual([])
  })

  it("keeps one entry when the same channel is saved twice", async () => {
    const kv = fakeStore()
    const secrets = secureSecrets(kv)

    await secrets.saveChannel(dev)
    await secrets.saveChannel({ ...dev, label: "renamed" })
    expect(await secrets.loadChannels()).toEqual([{ ...dev, label: "renamed" }])
    expect(JSON.parse(kv.items["kiwi.channels"] ?? "[]")).toEqual(["mc2-dev"])
  })

  it("keys a channel with no join code by its member key", async () => {
    const kv = fakeStore()
    const secrets = secureSecrets(kv)

    await secrets.saveChannel(imported)
    expect(imported.code).toBeUndefined()
    expect(await secrets.loadChannels()).toEqual([imported])
    await secrets.removeChannel(imported.pk)
    expect(await secrets.loadChannels()).toEqual([])
  })

  it("leaves the person key alone when a channel goes", async () => {
    const kv = fakeStore()
    const secrets = secureSecrets(kv)

    await secrets.savePerson(person)
    await secrets.saveChannel(dev)
    await secrets.removeChannel(channelId(dev))
    expect(await secrets.loadPerson()).toEqual(person)
    expect(kv.items["kiwi.channels"]).toBeUndefined()
  })

  it("reads nothing out of a value that is not JSON", async () => {
    const kv = fakeStore({ "kiwi.person": "not json", "kiwi.channels": "nope", "kiwi.channel.mc2-dev": "{" })
    const secrets = secureSecrets(kv)

    expect(await secrets.loadPerson()).toBeNull()
    expect(await secrets.loadChannels()).toEqual([])
  })

  it("ignores a channel the index names but that is gone", async () => {
    const kv = fakeStore({ "kiwi.channels": JSON.stringify(["mc2-dev", "mc2-other"]), "kiwi.channel.mc2-other": JSON.stringify(other) })
    const secrets = secureSecrets(kv)

    expect(await secrets.loadChannels()).toEqual([other])
  })
})
