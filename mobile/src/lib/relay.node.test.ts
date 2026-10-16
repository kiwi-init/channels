import { Channel } from "@mc/client.ts"
import { generateIdentity } from "@mc/identity.ts"
import type { Message } from "@mc/protocol.ts"
import { PUBLIC_RELAY, relayUrl, setRelayUrl, watchChannel, watchedRooms } from "./relay"
import { startTestRelay, type TestRelay } from "./relay-fixture"
import { run } from "./runtime"

jest.setTimeout(60_000)

let relay = ""
let testRelay: TestRelay | undefined

beforeAll(async () => {
  testRelay = await startTestRelay()
  relay = testRelay.url
})

afterAll(async () => {
  await testRelay?.stop()
})

async function channel(): Promise<Channel> {
  const owner = await generateIdentity("owner")
  const person = await generateIdentity("person")
  const { access } = await Channel.create(relay, owner, { name: owner.name, kind: "human", person: person.pk }, [], undefined, null)
  return new Channel(access, relay, owner)
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

describe("relay url", () => {
  it("is the public relay until told otherwise, and refuses what is not a relay origin", () => {
    expect(relayUrl()).toBe(PUBLIC_RELAY)
    expect(setRelayUrl("not a url")).toBe(false)
    expect(setRelayUrl("ftp://example.com")).toBe(false)
    expect(relayUrl()).toBe(PUBLIC_RELAY)
    expect(setRelayUrl("http://127.0.0.1:8787/some/path")).toBe(true)
    expect(relayUrl()).toBe("http://127.0.0.1:8787")
    setRelayUrl(PUBLIC_RELAY)
  })
})

describe("a channel's live stream", () => {
  it("joins a room and receives one message", async () => {
    const ch = await channel()
    const heard: Message[] = []
    let ready: number | undefined
    const stop = watchChannel(ch, 0, { message: (m) => heard.push(m), ready: (head) => (ready = head) })
    try {
      await until(() => ready, "the stream to catch up")
      await run(ch.fx.send("hello from the app", {}))
      const got = await until(() => heard.find((m) => m.body === "hello from the app"), "the message")
      expect(got.from).toBe("owner")
      expect(watchedRooms()).toContain(ch.roomId)
    } finally {
      stop()
    }
    expect(watchedRooms()).not.toContain(ch.roomId)
  })

  it("keeps one socket per room: watching again replaces the first", async () => {
    const ch = await channel()
    const first: Message[] = []
    const second: Message[] = []
    let ready: number | undefined
    const stopFirst = watchChannel(ch, 0, { message: (m) => first.push(m) })
    const stopSecond = watchChannel(ch, 0, { message: (m) => second.push(m), ready: (head) => (ready = head) })
    try {
      await until(() => ready, "the second stream to catch up")
      await run(ch.fx.send("only once", {}))
      await until(() => second.find((m) => m.body === "only once"), "the message")
      expect(first.find((m) => m.body === "only once")).toBeUndefined()
      expect(watchedRooms().filter((r) => r === ch.roomId)).toHaveLength(1)
    } finally {
      stopFirst()
      stopSecond()
    }
  })

  it("resumes from where it was told: a stream started after a message does not replay it", async () => {
    const ch = await channel()
    const seq = await run(ch.fx.send("old news", {}))
    const heard: Message[] = []
    let ready: number | undefined
    const stop = watchChannel(ch, seq, { message: (m) => heard.push(m), ready: (head) => (ready = head) })
    try {
      await until(() => ready, "the stream to catch up")
      await run(ch.fx.send("fresh news", {}))
      await until(() => heard.find((m) => m.body === "fresh news"), "the message")
      expect(heard.find((m) => m.body === "old news")).toBeUndefined()
    } finally {
      stop()
    }
  })
})
