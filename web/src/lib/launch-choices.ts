import type { KnownHarness } from "@kiwi/core/harnesses.ts"
import { choicesOf, claudeTakesLongContext, contextWords, readLaunchChoices, type HarnessOptions, type LaunchChoices, type Permission } from "@kiwi/core/launch-options.ts"

const KEY = "kiwi.launch-choices"
const ANYWHERE = "*"

type Saved = Record<string, Partial<Record<KnownHarness, Record<string, unknown>>>>

export const PERMISSION_LABEL: Record<Permission, string> = { default: "Default", "accept-edits": "Accept edits", plan: "Plan", bypass: "Bypass" }

export const EFFORT_LABEL: Record<string, string> = { none: "None", off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max" }

export const MODEL_PICKS: Partial<Record<KnownHarness, string[]>> = { claude: ["opus", "sonnet", "fable", "haiku"] }

export const contextLabel = (tokens: number): string => contextWords(tokens).toUpperCase()

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Saved) : {}
  } catch {
    // No storage, or something that isn't ours under the key: nothing is remembered.
    return {}
  }
}

export function fitChoices(c: Partial<Record<keyof LaunchChoices, unknown>>, o: HarnessOptions): LaunchChoices {
  const one = (k: keyof LaunchChoices): LaunchChoices => readLaunchChoices({ [k]: c[k] }) ?? {}
  const { model } = one("model")
  const { effort } = one("effort")
  const { permission } = one("permission")
  const { context } = one("context")
  return choicesOf({
    model: o.model ? model : undefined,
    effort: effort !== undefined && o.effort.includes(effort) ? effort : undefined,
    permission: permission !== undefined && o.permission.includes(permission) ? permission : undefined,
    context: context !== undefined && o.context.includes(context) ? context : undefined,
  })
}

export function rememberedChoices(computer: string, harness: KnownHarness, o: HarnessOptions): LaunchChoices {
  const saved = load()
  const c = saved[computer]?.[harness] ?? saved[ANYWHERE]?.[harness]
  return c && typeof c === "object" ? fitChoices(c, o) : {}
}

export function rememberChoices(computer: string, harness: KnownHarness, c: LaunchChoices): void {
  const saved = load()
  const next: Saved = { ...saved, [computer]: { ...saved[computer], [harness]: { ...c } }, [ANYWHERE]: { ...saved[ANYWHERE], [harness]: { ...c } } }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // No storage: the choice holds only for this launch.
  }
}

export function choicesProblem(harness: KnownHarness, c: LaunchChoices): string | null {
  if (c.model !== undefined && !readLaunchChoices({ model: c.model })) return "A model is one word or id, like opus or claude-opus-5-5, with no spaces."
  if (harness === "claude" && c.context !== undefined && !claudeTakesLongContext(c.model)) return "1M context needs an Opus, Sonnet or Fable model: pick one above."
  return null
}

export function choicesWords(c: LaunchChoices): string[] {
  return [
    c.model,
    c.effort && (EFFORT_LABEL[c.effort] ?? c.effort).toLowerCase(),
    c.permission && c.permission !== "default" && PERMISSION_LABEL[c.permission].toLowerCase(),
    c.context && contextLabel(c.context),
  ].filter((w): w is string => !!w)
}
