import { FuseV1Options, getCurrentFuseWire } from "@electron/fuses"
import { FuseState } from "@electron/fuses/dist/constants"
import { resolve } from "node:path"

const REQUIRED: ReadonlyArray<readonly [FuseV1Options, FuseState]> = [
  [FuseV1Options.RunAsNode, FuseState.DISABLE],
  [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
  [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseState.ENABLE],
  [FuseV1Options.OnlyLoadAppFromAsar, FuseState.ENABLE],
]

const stateName = (s: FuseState | undefined): string => (s === undefined ? "missing" : (FuseState[s] ?? `0x${s.toString(16)}`).toLowerCase())

async function wrongFuses(app: string): Promise<string[]> {
  const wire = await getCurrentFuseWire(app)
  return REQUIRED.filter(([fuse, want]) => wire[fuse] !== want).map(([fuse, want]) => `${FuseV1Options[fuse]} is ${stateName(wire[fuse])}, wants ${stateName(want)}`)
}

const apps = process.argv.slice(2).map((a) => resolve(a))
if (apps.length === 0) {
  console.error("usage: bun desktop/scripts/fuses.ts <Channels.app | linux executable>...")
  process.exit(2)
}
let failed = false
for (const app of apps) {
  const wrong = await wrongFuses(app).catch((e: unknown) => [`can't read its fuses: ${e instanceof Error ? e.message : String(e)}`])
  if (wrong.length === 0) console.log(`${app}: ${REQUIRED.map(([fuse, want]) => `${FuseV1Options[fuse]}=${stateName(want)}`).join(" ")}`)
  else {
    failed = true
    for (const w of wrong) console.error(`${app}: ${w}`)
  }
}
process.exit(failed ? 1 : 0)
