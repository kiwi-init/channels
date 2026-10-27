import { bareAt, memberNamed, readsAsHandle } from "@kiwi/core/state.ts"

const TOKEN = /(`+)[\s\S]*?\1|\[[^\]\n]*\]\([^)\n]*\)|<[^>\s]+>|https?:\/\/[^\s<>()]+|(?<![\p{L}\p{N}_.@-])@([\p{L}\p{N}_.-]+)|\bT(\d+)\b|(?<![\p{L}\p{N}\p{M}_/.@-])([\p{L}\p{N}_.-]+)/gu

type Found = { kind: "mention" | "bare"; name: string; label: string; rest: string } | { kind: "task"; id: number }

const escape = (text: string): string => text.replace(/[\\[\]]/g, "\\$&")

function swap(text: string, nicknames: ReadonlyMap<string, string>, out: (found: Found) => string | null): string {
  const labelOf = (name: string) => nicknames.get(name) ?? nicknames.get(name.toLowerCase())
  return text
    .split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$)/m)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(TOKEN, (whole: string, _tick: string | undefined, at: string | undefined, task: string | undefined, bare: string | undefined, offset: number) => {
            if (at !== undefined) {
              const who = memberNamed(at, labelOf)
              return (who && out({ kind: "mention", ...who, rest: at.slice(who.name.length) })) ?? whole
            }
            if (task !== undefined) return out({ kind: "task", id: Number(task) }) ?? whole
            if (bare !== undefined) {
              const who = memberNamed(bare, labelOf)
              const fits = who && readsAsHandle(who.name, who.label) && bareAt(part, offset, offset + who.name.length)
              return (fits && out({ kind: "bare", ...who, rest: bare.slice(who.name.length) })) || whole
            }
            return whole
          })
    )
    .join("")
}

export function linked(text: string, nicknames: ReadonlyMap<string, string>, tasks: ReadonlySet<number>): string {
  return swap(text, nicknames, (f) =>
    f.kind === "task" ? (tasks.has(f.id) ? `[T${f.id}](kiwi-task:${f.id})` : null) : `[${f.kind === "mention" ? "@" : ""}${escape(f.label)}](kiwi-mention:${f.name})${f.rest}`
  )
}

export function named(text: string, nicknames: ReadonlyMap<string, string>): string {
  return swap(text, nicknames, (f) => (f.kind === "task" ? null : `${f.kind === "mention" ? "@" : ""}${f.label}${f.rest}`))
}
