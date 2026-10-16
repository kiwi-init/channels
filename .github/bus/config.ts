import { z } from "zod"

const Tier = z.enum(["git", "mergiraf", "keep-both", "haiku", "opus"])
const Typecheck = z.object({ when: z.array(z.string()), dir: z.string().optional(), run: z.array(z.string()) }).strict()
const Model = z.object({ model: z.string(), samples: z.number().int().positive(), effort: z.enum(["low", "medium", "high", "xhigh", "max"]) }).strict()
const score = z.number().min(0).max(1)

const Bus = z
  .object({
    ladder: z.array(Tier),
    label: z.string(),
    label_roles: z.array(z.string()),
    maintainers: z.array(z.string()),
    on_behalf_of: z.string(),
    keep_both: score,
    intent_shift: score,
    needs_order: score,
    unrelated_failure: score,
    reruns: z.number().int().nonnegative(),
    haiku: Model,
    opus: Model,
    context_lines: z.number().int().nonnegative(),
    max_hunk_lines: z.number().int().positive(),
    lockfiles: z.array(z.string()),
    tsc: z.array(Typecheck),
  })
  .strict()

export type Tier = z.infer<typeof Tier>
export type Typecheck = z.infer<typeof Typecheck>
export type Model = z.infer<typeof Model>
export type BusConfig = z.infer<typeof Bus>

export async function loadBus(path: string): Promise<BusConfig> {
  const doc = Bun.YAML.parse(await Bun.file(path).text()) as { bus?: unknown }
  if (!doc.bus) throw new Error(`${path} has no bus: block`)
  const parsed = Bus.safeParse(doc.bus)
  if (!parsed.success) throw new Error(`${path} bus: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)
  return parsed.data
}
