import type { HarnessRow, KnownHarness } from "@kiwi/core/harnesses.ts"
import { harnessName } from "@kiwi/app/harness.ts"
import { harnessOf } from "~/live/map"
import type { App, Harness } from "~/model"

export const STARTS: Partial<Record<Harness, KnownHarness>> = { claude: "claude", codex: "codex", opencode: "opencode", gemini: "gemini", cursor: "cursor", grok: "grok" }

export function harnessChoices(rows: readonly HarnessRow[]): App["harnesses"] {
  const out = new Map<string, App["harnesses"][number]>()
  for (const r of rows) {
    const id = harnessOf(r.harness)
    if (!id || !STARTS[id] || out.has(id)) continue
    out.set(id, {
      id,
      label: harnessName(r.harness),
      installed: !!r.path && r.start,
      ...(r.version ? { version: r.version } : {}),
      ...(r.path ? { path: r.path } : {}),
      ...(!r.start && r.why ? { why: r.why } : {}),
    })
  }
  return [...out.values()]
}
