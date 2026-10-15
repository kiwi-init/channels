import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { coverageChunks, heavyIn, registryEntries, shProbe, stubbedChunks, stubPlugin } from "../scripts/cli-bundle.ts"
import { COMMANDS, runSh } from "../src/sh.ts"

const ROOT = resolve(import.meta.dir, "..")
const registry = await Bun.file(join(ROOT, "node_modules/just-bash/dist/bundle/index.js")).text()
const entries = registryEntries(registry)
const allowed = new Set<string>(COMMANDS)
const stubbed = stubbedChunks(entries, allowed, coverageChunks(registry))
const chunkOf = (name: string) => entries.find((e) => e.name === name)?.chunk

const FILES = { "/channel/README": "beta\nalpha\nbeta\n", "/channel/status.json": '{"a":1,"b":[2,3]}\n' }

const work = mkdtempSync(join(tmpdir(), "kiwi-cli-bundle-"))
afterAll(() => rmSync(work, { recursive: true, force: true }))

describe("the CLI bundle's kiwi sh", () => {
  test("every allowed command is one just-bash has", () => {
    expect(COMMANDS.filter((c) => chunkOf(c) === undefined)).toEqual([])
  })

  test("the commands kiwi sh can't run, and the coverage writer, are left out; the allowed ones stay", () => {
    for (const name of ["js-exec", "python3", "sqlite3", "html-to-markdown", "curl"]) expect(stubbed.has(chunkOf(name) ?? "")).toBe(true)
    for (const name of COMMANDS) expect(stubbed.has(chunkOf(name) ?? "")).toBe(false)
    expect(coverageChunks(registry)).toHaveLength(1)
    const outside = new Set(entries.filter((e) => !allowed.has(e.name)).map((e) => e.chunk))
    const inside = new Set(entries.filter((e) => allowed.has(e.name)).map((e) => e.chunk))
    expect(stubbed.size).toBe([...outside].filter((c) => !inside.has(c)).length + 1)
  })

  test("bundled, every allowed command answers as it does from source, and the heavy libraries are gone", async () => {
    const entry = join(work, "entry.ts")
    writeFileSync(
      entry,
      `import { runSh } from ${JSON.stringify(join(ROOT, "src/sh.ts"))}\n` +
        `const { files, scripts } = JSON.parse(await Bun.stdin.text())\n` +
        `const out = []\n` +
        `for (const script of scripts) out.push(await runSh(files, script, { cwd: "/channel" }))\n` +
        `console.log(JSON.stringify(out))\n`
    )
    const built = await Bun.build({ entrypoints: [entry], target: "bun", outdir: join(work, "out"), sourcemap: "external", plugins: [stubPlugin(stubbed)] })
    expect(built.success).toBe(true)
    const map: unknown = await Bun.file(join(work, "out", "entry.js.map")).json()
    const sources = typeof map === "object" && map !== null && "sources" in map && Array.isArray(map.sources) ? map.sources.filter((s): s is string => typeof s === "string") : []
    expect(sources.some((s) => s.includes("node_modules/just-bash/"))).toBe(true)
    expect(heavyIn(sources)).toEqual([])

    const scripts = COMMANDS.map(shProbe)
    const proc = Bun.spawn(["bun", join(work, "out", "entry.js")], { stdin: new Blob([JSON.stringify({ files: FILES, scripts })]), stdout: "pipe", stderr: "pipe" })
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    expect(code).toBe(0)
    const bundled: unknown = JSON.parse(stdout)
    const fromSource = []
    for (const script of scripts) fromSource.push(await runSh(FILES, script, { cwd: "/channel" }))
    expect(bundled).toEqual(fromSource)
    expect(fromSource.filter((r) => r.exitCode === 127).map((_, i) => scripts[i])).toEqual([])
  }, 60_000)
})
