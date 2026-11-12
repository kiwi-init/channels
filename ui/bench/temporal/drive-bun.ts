import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { ZONES } from "./corpus.ts"

const dir = import.meta.dir
const [outPath = join(dir, "bun.json"), zonesArg = ""] = process.argv.slice(2)
const zones = zonesArg ? zonesArg.split(",") : [...ZONES]
const COLD_RUNS = 10

const run = (args: string[], tz: string): unknown => {
  const p = Bun.spawnSync(["bun", join(dir, "bun-run.ts"), ...args], { env: { ...process.env, TZ: tz }, stdout: "pipe", stderr: "inherit" })
  if (p.exitCode !== 0) throw new Error(`bun-run ${args.join(" ")} TZ=${tz} exited ${p.exitCode}`)
  return JSON.parse(p.stdout.toString())
}

const steady: Record<string, unknown> = {}
for (const zone of zones) {
  steady[zone] = run(["steady"], zone)
  console.error(`bun ${zone} done`)
}
const cold: Record<string, unknown[]> = { date: [], temporal: [], polyfill: [] }
for (let i = 0; i < COLD_RUNS; i++) for (const impl of Object.keys(cold)) cold[impl]!.push(run(["cold", impl], "America/New_York"))
writeFileSync(outPath, JSON.stringify({ version: Bun.version, revision: Bun.revision, steady, cold }))
console.error(`wrote ${outPath}`)
