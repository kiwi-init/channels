import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { generateIdentity } from "@mc/identity.ts"
import type { ChannelIdentityView, PersonView } from "../../../desktop/src/bridge.ts"
import { createBackupHost } from "../../../desktop/src/backup-host.ts"
import { NO_BACKUP, WRONG_WORDS, fetchAccountBackup, restoreFromBackup } from "./account"
import { createEngine } from "./engine"
import { secureSecrets, type SecureKV } from "./secrets"
import { signIn } from "./signIn"

jest.setTimeout(120_000)

let relay = ""
let child: ChildProcess | undefined
const dir = mkdtempSync(join(tmpdir(), "kiwi-mobile-account-"))

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
  const port = await freePort()
  child = spawn("bun", [resolve(__dirname, "../../../src/relay/bun.ts"), "--hostname", "127.0.0.1", "--port", String(port), "--data", join(dir, "relay"), "--dev-sign-in"], {
    stdio: ["ignore", "pipe", "inherit"],
  })
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
  return { getItemAsync: async (k) => kept.get(k) ?? null, setItemAsync: async (k, v) => void kept.set(k, v), deleteItemAsync: async (k) => void kept.delete(k) }
}

async function desktop(): Promise<{ person: PersonView; channels: ChannelIdentityView[] }> {
  const id = await generateIdentity("Ada")
  const member = await generateIdentity("Ada in dev")
  return {
    person: { name: id.name, pk: id.pk, sk: id.sk, xpk: id.xpk!, xsk: id.xsk! },
    channels: [{ label: "dev", pk: member.pk, sk: member.sk, xpk: member.xpk!, xsk: member.xsk!, code: "code-1", roomId: "room-1" }],
  }
}

describe("the account backup, from the desktop host to the phone", () => {
  it("backs up on the desktop, signs in on the phone, and the same person and channels land on it", async () => {
    const mine = await desktop()
    const host = createBackupHost({ person: () => mine.person, channels: () => mine.channels, relay: () => relay, token: async () => "dev:ada" })
    const { passphrase } = await host.run()

    const phone = createEngine(secureSecrets(memoryKV()), () => relay)
    await phone.load()
    const token = await signIn({ relay, open: async () => {}, devName: "ada" })
    expect(token).toBe("dev:ada")
    const envelope = await fetchAccountBackup(relay, token)
    const restored = await restoreFromBackup(phone, envelope, passphrase.toUpperCase().replaceAll(" ", "  "))
    expect(restored).toEqual({ name: "Ada", channels: 1 })
    expect(phone.person()?.pk).toBe(mine.person.pk)
    expect(phone.person()?.sk).toBe(mine.person.sk)
    expect(phone.seats().map((s) => s.pk)).toEqual(mine.channels.map((c) => c.pk))
  })

  it("wrong words open nothing and leave the phone empty", async () => {
    const mine = await desktop()
    await createBackupHost({ person: () => mine.person, channels: () => [], relay: () => relay, token: async () => "dev:bob" }).run()
    const phone = createEngine(secureSecrets(memoryKV()), () => relay)
    await phone.load()
    const envelope = await fetchAccountBackup(relay, "dev:bob")
    await expect(restoreFromBackup(phone, envelope, "alpha bravo charlie delta echo foxtrot")).rejects.toThrow(WRONG_WORDS)
    expect(phone.person()).toBeNull()
    await expect(restoreFromBackup(phone, envelope, "123456")).rejects.toThrow()
  })

  it("another account sees no backup", async () => {
    await expect(fetchAccountBackup(relay, "dev:nobody")).rejects.toThrow(NO_BACKUP)
  })
})
