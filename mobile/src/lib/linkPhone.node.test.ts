import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { generateIdentity } from "@mc/identity.ts"
import type { ChannelIdentityView, PersonView, PhoneView } from "../../../desktop/src/bridge.ts"
import { createLinkHost } from "../../../desktop/src/link-host.ts"
import { CODE_USED, NOT_A_LINK_CODE, NO_ANSWER, linkPhone, toChannelIdentity, type LinkStep } from "./linkPhone"
import { createEngine } from "./engine"
import { secureSecrets, type SecureKV } from "./secrets"

jest.setTimeout(60_000)

let relay = process.env.KIWI_TEST_RELAY ?? ""
let child: ChildProcess | undefined
const dir = mkdtempSync(join(tmpdir(), "kiwi-mobile-link-"))

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

function memoryKV(): SecureKV {
  const kept = new Map<string, string>()
  return {
    getItemAsync: async (key) => kept.get(key) ?? null,
    setItemAsync: async (key, value) => void kept.set(key, value),
    deleteItemAsync: async (key) => void kept.delete(key),
  }
}

async function desktop() {
  const id = await generateIdentity("Ada Lovelace")
  const person: PersonView = { name: id.name, pk: id.pk, sk: id.sk, xpk: id.xpk!, xsk: id.xsk! }
  const channels: ChannelIdentityView[] = await Promise.all(
    [0, 1].map(async (i) => {
      const c = await generateIdentity(`member-${i}`)
      return { label: `channel ${i}`, pk: c.pk, sk: c.sk, xpk: c.xpk, xsk: c.xsk, code: `mc2-code-${i}`, idName: `ada-${i}`, access: { epoch: 1 } }
    })
  )
  const linked: PhoneView[] = []
  const host = createLinkHost({ relayUrl: () => relay, person: () => person, channels: () => channels, linked: (p) => linked.push(p) })
  return { person, channels, host, linked }
}

function phone(waitMs?: number) {
  const engine = createEngine(secureSecrets(memoryKV()), () => relay)
  const steps: LinkStep[] = []
  const relays: string[] = []
  const stop = new AbortController()
  const deps = { adopt: (p: PersonView, c: ChannelIdentityView[]) => engine.adopt(p, c), setRelay: (u: string) => (relays.push(u), true), deviceName: "Ada's iPhone", waitMs }
  const run = (text: string) => linkPhone(text, deps, (s) => steps.push(s), stop.signal)
  const until = async (kind: LinkStep["kind"]) => {
    for (let i = 0; i < 400; i++) {
      const found = steps.find((s) => s.kind === kind)
      if (found) return found
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error(`never reached ${kind}: ${JSON.stringify(steps)}`)
  }
  return { engine, steps, relays, run, until, stop }
}

describe("a phone links to the desktop app", () => {
  it("shows the digits, and after the desktop says yes holds the same person and channels", async () => {
    const d = await desktop()
    const p = phone()
    const { code } = await d.host.begin()
    const running = p.run(code)
    const waiting = (await p.until("waiting")) as Extract<LinkStep, { kind: "waiting" }>
    const ask = await d.host.poll()
    expect(ask?.label).toBe("Ada's iPhone")
    expect(ask?.digits).toBe(waiting.digits)
    expect(waiting.relay).toBe(relay)
    await d.host.answer(true)
    await running

    expect(p.steps.at(-1)).toEqual({ kind: "done", name: "Ada Lovelace", channels: 2 })
    expect(p.engine.person()).toEqual(d.person)
    expect(p.engine.seats().map((s) => s.label)).toEqual(["channel 0", "channel 1"])
    expect(p.engine.seats()[1]).toMatchObject({ pk: d.channels[1]!.pk, sk: d.channels[1]!.sk, idName: "ada-1", code: "mc2-code-1" })
    expect(p.relays).toEqual([relay])
    expect(d.linked.map((l) => l.label)).toEqual(["Ada's iPhone"])
  })

  it("refuses what is not a link code, without asking anyone", async () => {
    const p = phone()
    await p.run("hello")
    expect(p.steps).toEqual([{ kind: "error", message: NOT_A_LINK_CODE }])
    expect(p.engine.person()).toBeNull()
  })

  it("says a code was already used when another phone got there first", async () => {
    const d = await desktop()
    const first = phone()
    const second = phone()
    const { code } = await d.host.begin()
    void first.run(code)
    await first.until("waiting")
    await second.run(code)
    expect(second.steps.at(-1)).toEqual({ kind: "error", message: CODE_USED })
    expect(second.engine.person()).toBeNull()
    first.stop.abort()
  })

  it("says so when the desktop says no, or never answers, and keeps nothing", async () => {
    const d = await desktop()
    const p = phone(600)
    const { code } = await d.host.begin()
    const running = p.run(code)
    await p.until("waiting")
    await d.host.poll()
    await d.host.answer(false)
    await running
    expect(p.steps.at(-1)).toEqual({ kind: "error", message: NO_ANSWER })
    expect(p.engine.person()).toBeNull()
    expect(p.engine.seats()).toEqual([])
  })
})

describe("toChannelIdentity", () => {
  it("keeps the known fields it was sent, and leaves out what is not a field", () => {
    expect(toChannelIdentity({ label: "a", pk: "p", sk: "s", code: "mc2-x", at: 5, imported: true, access: { epoch: 2 }, junk: 1 })).toEqual({
      label: "a",
      pk: "p",
      sk: "s",
      code: "mc2-x",
      at: 5,
      imported: true,
      access: { epoch: 2 },
    })
  })
})
