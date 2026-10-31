import { sanitizeMarkdownUrl } from "@kiwi/app/markdown.ts"
import { literal, spansOf, swap } from "@kiwi/app/mentions.ts"

export { named } from "@kiwi/app/mentions.ts"

function remote(url: string, alt: string): string | null {
  if (/^(?:data|blob):/i.test(url.trim())) return null
  const safe = sanitizeMarkdownUrl(url)
  if (!safe || !/^https?:\/\//i.test(safe)) return literal(alt)
  const at = new URL(safe)
  return `[${literal(alt || "image")} (opens ${at.hostname})](<${at.href}>)`
}

export function linked(text: string, nicknames: ReadonlyMap<string, string>, tasks: ReadonlySet<number>, before?: number): string {
  return swap(
    text,
    nicknames,
    (hit) =>
      hit.kind === "task"
        ? tasks.has(hit.id)
          ? `[T${hit.id}](kiwi-task:${hit.id})`
          : null
        : hit.kind === "ref"
          ? `[#${hit.seq}](kiwi-msg:${hit.seq})`
          : hit.kind === "image"
            ? remote(hit.url, hit.alt)
            : `[${hit.kind === "mention" ? "@" : ""}${literal(hit.label)}](kiwi-mention:${hit.name})`,
    before
  )
}

const NAME_GOES_ON = /[\p{L}\p{N}\p{M}_\\-]|[./][\p{L}\p{N}]/uy
const NAME_BEFORE = /[\p{L}\p{N}\p{M}_.@\\/-]$/u
const MARKUP = /[\\`*[\]<>|~]|^_|_$/

type Named = { name: string; display?: string | undefined }

export type Picks = Map<string, string>

export function mentionNames(
  people: readonly Named[],
  former: readonly Named[] = []
): { typed: (handle: string, picks?: Picks) => string; sent: (text: string, picks?: ReadonlyMap<string, string>) => string } {
  const fold = (s: string) => s.toLowerCase()
  const taken = new Map<string, number>()
  const count = (key: string) => taken.set(key, (taken.get(key) ?? 0) + 1)
  for (const p of [...people, ...former]) {
    count(fold(p.name))
    if (p.display && fold(p.display) !== fold(p.name)) count(fold(p.display))
  }
  const nicks = people.flatMap((p) => (p.display && fold(p.display) !== fold(p.name) && taken.get(fold(p.display)) === 1 ? [{ display: p.display, handle: p.name }] : []))
  const displayOf = new Map(people.map((p) => [p.name, p.display]))
  const sent = (text: string, picks: ReadonlyMap<string, string> = new Map()) => {
    const known = [...[...picks].map(([display, handle]) => ({ display, handle })), ...nicks.filter((n) => !picks.has(fold(n.display)))].sort((a, b) => b.display.length - a.display.length)
    let result = ""
    let from = 0
    for (const span of spansOf(text)) {
      for (let at = text.indexOf("@", span.start); at !== -1 && at < span.end; at = text.indexOf("@", at + 1)) {
        if (NAME_BEFORE.test(text.slice(0, at))) continue
        const hit = known.find(({ display }) => {
          const end = at + 1 + display.length
          NAME_GOES_ON.lastIndex = end
          return end <= span.end && fold(text.slice(at + 1, end)) === fold(display) && !NAME_GOES_ON.test(text)
        })
        if (!hit) continue
        result += `${text.slice(from, at)}@${hit.handle}`
        from = at + 1 + hit.display.length
        at = from - 1
      }
    }
    return result + text.slice(from)
  }
  const typed = (handle: string, picks?: Picks) => {
    const display = displayOf.get(handle)
    if (!display || fold(display) === fold(handle) || MARKUP.test(display)) return handle
    const key = fold(display)
    const held = picks?.get(key)
    if (held !== undefined && held !== handle) return handle
    const trial = new Map(picks ?? [])
    if (picks) trial.set(key, handle)
    if (sent(`@${display} x`, trial) !== `@${handle} x`) return handle
    picks?.set(key, handle)
    return display
  }
  return { typed, sent }
}

function unused(text: string): [string, string] {
  const free: string[] = []
  for (let code = 0xe000; free.length < 2; code++) if (!text.includes(String.fromCharCode(code))) free.push(String.fromCharCode(code))
  return [free[0] ?? "", free[1] ?? ""]
}

export function withNames(text: string, nicknames: ReadonlyMap<string, string>, plain: (text: string) => string): string {
  const [open, close] = unused(text)
  const labels: string[] = []
  const marked = swap(text, nicknames, (hit) => {
    if (hit.kind !== "mention" && hit.kind !== "bare") return null
    labels.push(`${hit.kind === "mention" ? "@" : ""}${hit.label}`)
    return `${open}${labels.length - 1}${close}`
  })
  return plain(marked).replace(new RegExp(`${open}(\\d+)${close}`, "g"), (whole: string, i: string) => labels[Number(i)] ?? whole)
}
