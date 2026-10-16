export type Tier = "git" | "mergiraf" | "keep-both" | "haiku" | "opus"

export type Typecheck = { when: string[]; dir?: string; run: string[] }

export type Model = { model: string; samples: number; effort: "low" | "medium" | "high" | "xhigh" | "max" }

export type BusConfig = {
  ladder: Tier[]
  label: string
  label_roles: string[]
  on_behalf_of: string
  keep_both: number
  intent_shift: number
  needs_order: number
  unrelated_failure: number
  reruns: number
  haiku: Model
  opus: Model
  context_lines: number
  max_hunk_lines: number
  lockfiles: string[]
  tsc: Typecheck[]
}

export async function loadBus(path: string): Promise<BusConfig> {
  const doc = Bun.YAML.parse(await Bun.file(path).text()) as { bus?: BusConfig }
  if (!doc.bus) throw new Error(`${path} has no bus: block`)
  return doc.bus
}
