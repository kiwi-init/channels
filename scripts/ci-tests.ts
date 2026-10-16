// The test suite in CI's groups, so each group is its own job: jev-ci can skip the groups a
// change can't reach, and the slow agent flows run side by side instead of one after another.
//
//   bun scripts/ci-tests.ts core | flows-a | flows-b
//
// A new test file lands in core unless it's added to a flows group here.

import { Glob } from "bun"
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const FLOWS: Record<string, string[]> = {
  "flows-a": ["e2e", "verbs", "threads", "reconnect"],
  "flows-b": ["join-seats", "read-receipts", "daemon-pair", "sh-escape", "coordinator-follows", "reclaim", "wake-yourself"],
  "desktop-keys": ["desktop-keys"],
  site: ["site"],
  pins: ["action-pins"],
  seats: ["seats", "multi-seat"],
  budget: [...new Glob("test/budget-*.test.ts").scanSync()].map((f) => f.slice("test/".length, -".test.ts".length)).sort(),
}

const group = process.argv[2] ?? ""
const all = [...new Glob("test/*.test.ts").scanSync(), ...new Glob("web/src/**/*.test.{ts,tsx}").scanSync()].sort()
const slow = new Set(Object.values(FLOWS).flat().map((name) => `test/${name}.test.ts`))
const files = group === "core" ? all.filter((f) => !slow.has(f)) : FLOWS[group]?.map((name) => `test/${name}.test.ts`)
if (!files) {
  console.error(`usage: bun scripts/ci-tests.ts ${["core", ...Object.keys(FLOWS)].join(" | ")}`)
  process.exit(2)
}
const missing = files.filter((f) => !all.includes(f))
if (missing.length) {
  console.error(`missing test files: ${missing.join(", ")}`)
  process.exit(1)
}

function tmpBehindSymlink(): { dir: string; cleanup: () => void } {
  const tmp = resolve(tmpdir())
  if (realpathSync(tmp) !== tmp) return { dir: tmp, cleanup: () => {} }
  const real = mkdtempSync(join(tmp, "kiwi-tmp-"))
  const link = `${real}.link`
  symlinkSync(real, link)
  return {
    dir: link,
    cleanup: () => {
      rmSync(link, { force: true })
      rmSync(real, { recursive: true, force: true })
    },
  }
}

const tmp = tmpBehindSymlink()
const proc = Bun.spawn(["bun", "test", "--parallel", ...files.map((f) => `./${f}`)], {
  stdio: ["inherit", "inherit", "inherit"],
  env: { ...process.env, TMPDIR: tmp.dir },
})
const code = await proc.exited
tmp.cleanup()
process.exit(code)
