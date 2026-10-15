import { expect, setDefaultTimeout, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { AgentLive, AgentSession } from "../src/agent.ts"
import { Channel } from "../src/client.ts"
import { loadConfig, updateConfig } from "../src/config.ts"
import { generateIdentity } from "../src/identity.ts"
import { startRelay } from "../src/relay/bun.ts"
import { handshake, joinAgent, pairComputer, setupChannel } from "./owner.ts"

setDefaultTimeout(30_000)

async function until(pred: () => boolean | Promise<boolean>, label: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms
  while (!(await pred())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`)
    await Bun.sleep(50)
  }
}

const run = <A, E>(e: Effect.Effect<A, E, unknown>) => Effect.runPromise(e.pipe(Effect.provide(AgentLive)) as Effect.Effect<A, E, never>)

function writeId(home: string, roomId: string, id: { name: string }): void {
  const path = join(home, "identities", roomId, `${id.name}.json`)
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 })
  writeFileSync(path, JSON.stringify(id, null, 2) + "\n", { mode: 0o600 })
}

test("an agent seat on the owner's machine notices a join request already waiting, and one that arrives later", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-notice-relay-"))
  const home = mkdtempSync(join(tmpdir(), "kiwi-notice-home-"))
  const was = process.env.KIWI_HOME
  process.env.KIWI_HOME = home
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir })
  try {
    const owner = await setupChannel(server.url.origin, { ownerName: "lead" })
    const computer = await pairComputer(owner.person)
    const { id: agent } = await joinAgent(owner, "dev", computer)
    updateConfig((cfg) => {
      cfg.channels.room = { ...owner.access, relay: owner.relay, code: owner.code, as: "dev", owner: "lead" }
    })
    writeId(home, owner.roomId, owner.owner)
    writeId(home, owner.roomId, agent)

    const first = await generateIdentity("guest")
    const { requestId: firstId } = await Channel.requestJoin(owner.relay, owner.code, first, { name: "guest" })
    await handshake(owner, [{ id: first, requestId: firstId }])

    const notices: string[] = []
    const session = await AgentSession.open("room", loadConfig().channels.room!, "dev")
    const fiber = await run(
      Effect.forkDetach(
        session.listen(() => Effect.void, {
          onNotice: (text) => Effect.sync(() => void notices.push(text)),
        }),
      ),
    )
    try {
      await until(() => notices.some((n) => n.includes("verification code") && n.includes("guest")), "notice for the waiting request")

      const later = await generateIdentity("other")
      const { requestId: laterId } = await Channel.requestJoin(owner.relay, owner.code, later, { name: "other" })
      await handshake(owner, [{ id: later, requestId: laterId }])
      await until(() => notices.some((n) => n.includes("other")), "notice for a request after listen started")
    } finally {
      await run(Fiber.interrupt(fiber))
    }
  } finally {
    server.stop(true)
    if (was === undefined) delete process.env.KIWI_HOME
    else process.env.KIWI_HOME = was
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true })
  }
})

test("a session with no owner key on this machine never calls onNotice", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "kiwi-notice-none-relay-"))
  const home = mkdtempSync(join(tmpdir(), "kiwi-notice-none-home-"))
  const was = process.env.KIWI_HOME
  process.env.KIWI_HOME = home
  const server = startRelay({ port: 0, hostname: "127.0.0.1", dataDir })
  try {
    const owner = await setupChannel(server.url.origin, { ownerName: "lead" })
    const computer = await pairComputer(owner.person)
    const { id: agent } = await joinAgent(owner, "dev", computer)
    updateConfig((cfg) => {
      cfg.channels.room = { ...owner.access, relay: owner.relay, code: owner.code, as: "dev" }
    })
    writeId(home, owner.roomId, agent)

    const notices: string[] = []
    const session = await AgentSession.open("room", loadConfig().channels.room!, "dev")
    const fiber = await run(
      Effect.forkDetach(
        session.listen(() => Effect.void, {
          onNotice: (text) => Effect.sync(() => void notices.push(text)),
        }),
      ),
    )
    try {
      const guest = await generateIdentity("guest")
      const { requestId } = await Channel.requestJoin(owner.relay, owner.code, guest, { name: "guest" })
      await handshake(owner, [{ id: guest, requestId }])
      await Bun.sleep(800)
      expect(notices).toEqual([])
    } finally {
      await run(Fiber.interrupt(fiber))
    }
  } finally {
    server.stop(true)
    if (was === undefined) delete process.env.KIWI_HOME
    else process.env.KIWI_HOME = was
    for (const d of [dataDir, home]) rmSync(d, { recursive: true, force: true })
  }
})
