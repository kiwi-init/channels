import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Channel } from "@mc/client.ts"
import { generateIdentity } from "@mc/identity.ts"
import type { Message } from "@mc/protocol.ts"
import { PUBLIC_RELAY, relayUrl, setRelayUrl, watchChannel, watchedRooms } from "./relay"
import { run } from "./runtime"

jest.setTimeout(60_000)

let relay = process.env.KIWI_TEST_RELAY ?? ""
let child: ChildProcess | undefined
const dir = mkdtempSync(join(tmpdir(), "kiwi-mobile-relay-"))

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const server = createServer()
    server.once("error", fail)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => (address && typeof address === "object" ? ok(address.port) : fail(new Error("no port"))))
    })
  })
}

beforeAll(async () => {
  if (relay) return
  const port = await freePort()
  child = spawn("bun", [resolve(__dirname, "../../../src/relay/bun.ts"), "--hostname", "127.0.0.1", "--port", String(port), "--data", join(dir, "relay")], { stdio: ["ignore", "pipe", "inherit"] })
  await new Promise<void>((ok, fail) => {
    let out = ""
    child?.stdout?.on("data", (d: Buffer) => {
      out += d
      if (out.includes("listening")) ok()
    })
    child?.once("exit", (code) => fail(new Error(`relay exited (${code})`)))
  })
  relay = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  const exited = child ? new Promise<void>((ok) => child?.once("exit", () => ok())) : Promise.resolve()
  child?.kill()
  await exited
  rmSync(dir, { recursive: true, force: true })
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
