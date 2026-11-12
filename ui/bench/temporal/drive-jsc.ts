import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ZONES } from "./corpus.ts"

const dir = import.meta.dir
const [outPath = join(dir, "jsc.json"), jsc = "/usr/lib/webkit2gtk-4.1/jsc"] = process.argv.slice(2)
const built = await Bun.build({ entrypoints: [join(dir, "jsc-entry.ts")], target: "browser", format: "iife", minify: true })
if (!built.success) throw new Error(built.logs.join("\n"))
const script = join(dir, ".jsc-bundle.js")
writeFileSync(script, `var __corpus = ${readFileSync(join(dir, "corpus.json"), "utf8")};\n${await built.outputs[0]!.text()}`)
const COLD_RUNS = 10

const run = (args: string[], tz: string): unknown => {
  const p = Bun.spawnSync([jsc, script, "--", ...args], { env: { ...process.env, TZ: tz }, stdout: "pipe", stderr: "inherit" })
  const lines = p.stdout.toString().split("\n").filter((l) => l && !l.startsWith("#"))
  if (p.exitCode !== 0 || !lines.length) throw new Error(`jsc ${args.join(" ")} TZ=${tz} exited ${p.exitCode}: ${p.stdout.toString().slice(0, 500)}`)
  return JSON.parse(lines.at(-1)!)
}

const version = Bun.spawnSync(["pacman", "-Q", "webkit2gtk-4.1"]).stdout.toString().trim()
const steady: Record<string, unknown> = {}
for (const zone of ZONES) {
  steady[zone] = run(["steady"], zone)
  console.error(`jsc ${zone} done`)
}
const cold: Record<string, unknown[]> = { date: [], temporal: [], polyfill: [] }
for (let i = 0; i < COLD_RUNS; i++) for (const impl of Object.keys(cold)) cold[impl]!.push(run(["cold", impl], "America/New_York"))
writeFileSync(outPath, JSON.stringify({ jsc: { version, steady, cold } }))
console.error(`wrote ${outPath}`)
