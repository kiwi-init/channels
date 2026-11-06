export const SHOWN_MAX_BYTES = 8 * 1024 * 1024

export const LIVE_MAX = 3

export interface ShownFiles<F> {
  kind: string
  name: string
  page: F
  light: F | null
  snapshot: F
}

const PART = /^(.+)\.([a-z][a-z0-9]{0,31})(-light)?\.(html|svg)$/

export function drawnKinds(mods: readonly { name: string; state: string; needs: readonly string[] }[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of [...mods].sort((a, b) => a.name.localeCompare(b.name)))
    if (m.state === "on") for (const n of m.needs) if (n.startsWith("render:") && !out.has(n.slice(7))) out.set(n.slice(7), m.name)
  return out
}

export function shownIn<F extends { name: string; size: number }>(files: readonly F[], kinds: ReadonlySet<string>): { shown: ShownFiles<F>[]; rest: F[] } {
  const parts = new Map<string, { kind: string; name: string; page?: F; light?: F; snapshot?: F }>()
  for (const f of files) {
    const at = PART.exec(f.name)
    if (!at || !kinds.has(at[2]!) || (at[3] && at[4] === "svg")) continue
    const key = `${at[1]}.${at[2]}`
    const got = parts.get(key) ?? { kind: at[2]!, name: at[1]! }
    const slot = at[4] === "svg" ? "snapshot" : at[3] ? "light" : "page"
    if (got[slot]) continue
    got[slot] = f
    parts.set(key, got)
  }
  const shown: ShownFiles<F>[] = []
  const taken = new Set<F>()
  for (const p of parts.values()) {
    if (!p.page || !p.snapshot) continue
    const all = [p.page, p.snapshot, ...(p.light ? [p.light] : [])]
    if (all.reduce((n, f) => n + f.size, 0) > SHOWN_MAX_BYTES) continue
    shown.push({ kind: p.kind, name: p.name, page: p.page, light: p.light ?? null, snapshot: p.snapshot })
    for (const f of all) taken.add(f)
  }
  return { shown, rest: files.filter((f) => !taken.has(f)) }
}
