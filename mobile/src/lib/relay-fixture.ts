import { spawn, type ChildProcess } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

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

export interface TestRelay {
  url: string
  stop(): Promise<void>
}

export async function startTestRelay(): Promise<TestRelay> {
  const given = process.env.KIWI_TEST_RELAY
  if (given) return { url: given, stop: async () => {} }
  const dir = mkdtempSync(join(tmpdir(), "kiwi-mobile-relay-"))
  const port = await freePort()
  const child: ChildProcess = spawn("bun", [resolve(__dirname, "../../../src/relay/bun.ts"), "--hostname", "127.0.0.1", "--port", String(port), "--data", join(dir, "relay")], {
    stdio: ["ignore", "pipe", "inherit"],
  })
  await new Promise<void>((ok, fail) => {
    let out = ""
    child.stdout?.on("data", (d: Buffer) => {
      out += d
      if (out.includes("listening")) ok()
    })
    child.once("exit", (code) => fail(new Error(`relay exited (${code})`)))
  })
  return {
    url: `http://127.0.0.1:${port}`,
    stop: async () => {
      const exited = new Promise<void>((ok) => child.once("exit", () => ok()))
      child.kill()
      await exited
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
