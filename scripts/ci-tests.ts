// The test suite in CI's groups, so each group is its own job: jev-ci can skip the groups a
// change can't reach, and the slow agent flows run side by side instead of one after another.
//
//   bun scripts/ci-tests.ts core | flows-a | flows-b
//
// A new test file lands in core unless it's added to a flows group here.

import { Glob } from "bun"

const FLOWS: Record<string, string[]> = {
  "flows-a": ["e2e", "verbs", "threads", "reconnect"],
  "flows-b": ["join-seats", "read-receipts", "daemon-pair", "sh-escape", "coordinator-follows", "reclaim"],
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

const proc = Bun.spawn(["bun", "test", ...files.map((f) => `./${f}`)], { stdio: ["inherit", "inherit", "inherit"] })
process.exit(await proc.exited)
