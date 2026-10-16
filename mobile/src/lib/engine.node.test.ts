import { Channel } from "@mc/client.ts"
import { generateIdentity } from "@mc/identity.ts"
import type { Message } from "@mc/protocol.ts"

import { createEngine } from "./engine"
import { startTestRelay, type TestRelay } from "./relay-fixture"
import { watchChannel } from "./relay"
import type { ChannelIdentityView, Secrets } from "./secrets"
import type { PersonView } from "../../../desktop/src/bridge.ts"

jest.setTimeout(60_000)

let testRelay: TestRelay | undefined
let relay = ""

beforeAll(async () => {
  testRelay = await startTestRelay()
  relay = testRelay.url
})

afterAll(async () => {
  await testRelay?.stop()
})

function memorySecrets(): Secrets & { channels: Map<string, ChannelIdentityView> } {
  let person: PersonView | null = null
  const channels = new Map<string, ChannelIdentityView>()
  return {
    channels,
    loadPerson: async () => person,
    savePerson: async (next) => void (person = next),
    removePerson: async () => void (person = null),
    loadChannels: async () => [...channels.values()],
    saveChannel: async (entry) => void channels.set(entry.code || entry.pk, entry),
    removeChannel: async (id) => void channels.delete(id),
  }
}

function until<T>(read: () => T | undefined, label: string): Promise<T> {
  return new Promise((ok, fail) => {
    const end = Date.now() + 20_000
    const tick = () => {
      const got = read()
      if (got !== undefined) return ok(got)
      if (Date.now() > end) return fail(new Error(`timed out waiting for ${label}`))
      setTimeout(tick, 50)
    }
    tick()
  })
}

const budget = { load: () => [], save: () => {} }

describe("the app's engine, against a real relay", () => {
  it("makes a person, asks to join, is approved, chats, and comes back after a restart", async () => {
    const owner = await generateIdentity("owner")
    const made = await Channel.create(relay, owner, { name: "owner", kind: "human" }, [], undefined, null, "Mobile test")
    const ownerCh = new Channel(made.access, relay, owner)

    const secrets = memorySecrets()
    const engine = createEngine(secrets, () => relay)
    await engine.load()
    expect(engine.person()).toBeNull()
    const person = await engine.createPerson("Ann")
    expect(engine.person()?.pk).toBe(person.pk)

    await engine.requestJoin(made.code)
    expect(engine.waiting()).toHaveLength(1)
    expect(engine.joined()).toHaveLength(0)
    let shown: string | null = null
    for (let round = 0; round < 10 && !shown; round++) {
      for (const req of await ownerCh.requests({ budget })) if (req.check === "unchecked") await ownerCh.checkRequest(req)
      const status = await engine.checkJoin(made.code)
      if (status.status === "pending" && status.code) shown = status.code
    }
    expect(shown).toMatch(/^\d{3}-\d{3}$/)

    const agreed = (await ownerCh.requests({ budget })).find((req) => req.check === "ready")
    expect(agreed?.code).toBe(shown)
    await ownerCh.approve(agreed!, undefined, {})

    expect(await engine.checkJoin(made.code)).toMatchObject({ status: "in" })
    expect(engine.joined()).toHaveLength(1)
    expect(engine.waiting()).toHaveLength(0)
    expect(secrets.channels.size).toBe(1)

    const ch = engine.channel(made.code)
    expect(ch).not.toBeNull()
    const heard: Message[] = []
    let ready: number | undefined
    const stop = watchChannel(ch!, 0, { message: (m) => heard.push(m), ready: (head) => (ready = head) })
    try {
      await until(() => ready, "the stream to catch up")
      await ownerCh.send("welcome, Ann", {})
      await until(() => heard.find((m) => m.body === "welcome, Ann"), "the owner's message")
      await ch!.send("hello from the phone", {})
    } finally {
      stop()
    }
    const log = await ownerCh.history(0)
    expect(log.messages.some((m) => m.body === "hello from the phone")).toBe(true)

    const again = createEngine(secrets, () => relay)
    await again.load()
    expect(again.person()?.pk).toBe(person.pk)
    expect(again.joined()).toHaveLength(1)
    const back = again.channel(made.code)
    expect(back).not.toBeNull()
    expect((await back!.history(0)).messages.some((m) => m.body === "welcome, Ann")).toBe(true)
  })

  it("forgets a channel", async () => {
    const owner = await generateIdentity("owner")
    const made = await Channel.create(relay, owner, { name: "owner", kind: "human" }, [], undefined, null, "Forget me")
    const secrets = memorySecrets()
    const engine = createEngine(secrets, () => relay)
    await engine.load()
    await engine.createPerson("Bo")
    await engine.requestJoin(made.code)
    await engine.forget(made.code)
    expect(engine.seats()).toHaveLength(0)
    expect(secrets.channels.size).toBe(0)
  })
})
