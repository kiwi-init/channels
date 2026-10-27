import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"

const TOKEN = /(`+)[\s\S]*?\1|\[[^\]\n]*\]\([^)\n]*\)|<[^>\s]+>|https?:\/\/[^\s<>()]+|(?<![\p{L}\p{N}_.@-])@([\p{L}\p{N}_.-]+)|\bT(\d+)\b/gu

export function linked(text: string, names: ReadonlySet<string>, tasks: ReadonlySet<number>): string {
  return text
    .split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$)/m)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(TOKEN, (whole: string, _tick: string | undefined, name: string | undefined, task: string | undefined) => {
            if (name !== undefined) {
              const known = names.has(name.toLowerCase()) ? name : names.has(name.replace(/\.+$/, "").toLowerCase()) ? name.replace(/\.+$/, "") : null
              return known ? `[@${known}](kiwi-mention:${known})${name.slice(known.length)}` : whole
            }
            if (task !== undefined && tasks.has(Number(task))) return `[T${task}](kiwi-task:${task})`
            return whole
          })
    )
    .join("")
}

const LIMIT = 800
const parsed = new Map<string, ASTNode>()

export const parsedFor = (markdown: string): ASTNode | undefined => parsed.get(markdown)

export function keepParsed(markdown: string, ast: ASTNode): void {
  parsed.delete(markdown)
  parsed.set(markdown, ast)
  const oldest = parsed.size > LIMIT ? parsed.keys().next().value : undefined
  if (oldest !== undefined) parsed.delete(oldest)
}
