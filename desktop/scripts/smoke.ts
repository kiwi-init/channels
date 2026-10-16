import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { daemonHello, daemonStop } from "../src/daemon-client.ts"

const exe = process.argv[2] ? resolve(process.argv[2]) : ""
if (!exe || !existsSync(exe)) {
  console.error("usage: bun desktop/scripts/smoke.ts <packaged app executable>")
  process.exit(2)
}

const root = mkdtempSync(join(tmpdir(), "kiwi-smoke-"))
const home = join(root, ".kiwi")
const flags = process.platform === "linux" ? ["--no-sandbox"] : []
const base: NodeJS.ProcessEnv = { ...process.env, HOME: root, KIWI_HOME: home, XDG_CONFIG_HOME: join(root, ".config"), XDG_DATA_HOME: join(root, ".local", "share") }
delete base["ELECTRON_RUN_AS_NODE"]
delete base["NODE_OPTIONS"]

const problems: string[] = []
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function children(): { pid: number; args: string }[] {
  const ps = spawnSync("ps", ["-A", "-o", "pid=,args="], { encoding: "utf8" })
  return ps.stdout
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), args: m[2] ?? "" }))
}

const renderer = (): number | null => children().find((p) => p.args.startsWith(exe) && p.args.includes("--type=renderer"))?.pid ?? null
const keyProcess = (): number | null => children().find((p) => p.args.startsWith(exe) && p.args.includes("--type=utility") && p.args.includes("node.mojom.NodeService"))?.pid ?? null

async function until<T>(what: string, ms: number, probe: () => Promise<T | null> | T | null): Promise<T | null> {
  const end = Date.now() + ms
  for (;;) {
    const got = await probe()
    if (got !== null) return got
    if (Date.now() > end) {
      problems.push(`${what}: nothing after ${ms / 1000}s`)
      return null
    }
    await sleep(500)
  }
}

interface Ran {
  out: string
  exited: boolean
}

function second(args: string[], env: NodeJS.ProcessEnv): Promise<Ran> {
  return new Promise((done) => {
    const child = spawn(exe, args, { env: { ...base, ...env }, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    child.stdout.on("data", (b: Buffer) => (out += b.toString("utf8")))
    child.stderr.on("data", (b: Buffer) => (out += b.toString("utf8")))
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      done({ out, exited: false })
    }, 20_000)
    child.on("exit", () => {
      clearTimeout(timer)
      done({ out, exited: true })
    })
  })
}

async function blocked(name: string, args: string[], env: NodeJS.ProcessEnv, ran: (r: Ran) => boolean): Promise<void> {
  const r = await second(args, env)
  if (!r.exited) problems.push(`${name}: the second launch didn't exit, so it didn't hand over to the running app`)
  else if (ran(r)) problems.push(`${name}: it worked against the packaged app:\n${r.out.trim()}`)
  else console.log(`${name}: refused`)
}

const app: ChildProcess = spawn(exe, flags, { env: base, stdio: ["ignore", "inherit", "inherit"], detached: true })
let appExited = false
let stopping = false
app.on("exit", (code, signal) => {
  appExited = true
  if (!stopping) problems.push(`the app exited (${signal ?? code}) during the smoke test`)
})

try {
  const keys = await until("the key process (utilityProcess, desktop/src/channels.ts)", 60_000, keyProcess)
  const hello = await until("the bundled kiwi daemon", 60_000, () => daemonHello(home, 1_000))
  const window = await until("the window's renderer", 60_000, renderer)
  if (window !== null) console.log(`window: rendering (pid ${window})`)
  if (keys !== null) {
    await sleep(5_000)
    if (keyProcess() === keys) console.log(`key process: running (pid ${keys})`)
    else problems.push(`the key process (pid ${keys}) didn't stay up: it's restarting`)
  }
  if (hello) console.log(`kiwi daemon: answering (kiwi ${hello.version})`)

  await blocked("ELECTRON_RUN_AS_NODE", ["-e", "process.stdout.write('kiwi-ran-as-node')"], { ELECTRON_RUN_AS_NODE: "1" }, (r) => r.out.includes("kiwi-ran-as-node"))
  await blocked("--inspect", [...flags, "--inspect=0"], {}, (r) => r.out.includes("Debugger listening"))
} finally {
  stopping = true
  if (!appExited && app.pid !== undefined) {
    try {
      process.kill(-app.pid, "SIGTERM")
    } catch {
      app.kill("SIGTERM")
    }
  }
  await daemonStop(home, 2_000)
  await sleep(1_000)
  rmSync(root, { recursive: true, force: true })
}

for (const p of problems) console.error(`smoke: ${p}`)
process.exit(problems.length ? 1 : 0)
