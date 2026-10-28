import type { HarnessRow } from "@kiwi/core/harnesses.ts"
import { harnessName } from "@/lib/harness"
import { harnessOf } from "~/live/map"
import type { App } from "~/model"

export function harnessChoices(rows: readonly HarnessRow[]): App["harnesses"] {
  const out = new Map<string, App["harnesses"][number]>()
  for (const r of rows) {
    const id = harnessOf(r.harness)
    if (!id || id === "other" || out.has(id)) continue
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
