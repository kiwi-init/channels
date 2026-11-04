import { preview } from "~/chat/preview"
import { store } from "~/live/value"
import type { Message } from "~/model"

export const MAX_EXCERPT = 600

export function cleanExcerpt(selected: string): string {
  const text = selected
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT - 1).trimEnd()}…` : text
}

export function withExcerpt(excerpt: string, comment: string): string {
  const quoted = excerpt
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n")
  const said = comment.trim()
  return said ? `${quoted}\n\n${said}` : quoted
}

export function excerptOf(text: string): { excerpt: string; rest: string } | null {
  const lines = text.split("\n")
  let at = 0
  while (at < lines.length && /^>/.test(lines[at] ?? "")) at++
  if (at === 0) return null
  const excerpt = lines
    .slice(0, at)
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n")
    .trim()
  if (!excerpt || /^\[!\w+\]/.test(excerpt)) return null
  return { excerpt, rest: lines.slice(at).join("\n").trim() }
}

const flat = (text: string): string => preview(text).toLowerCase()

export function excerptIn(excerpt: string, of: string): boolean {
  const part = flat(excerpt.replace(/…$/, ""))
  return part.length > 0 && flat(of).includes(part)
}

export function quotedExcerpt(m: Pick<Message, "text">, quoted: Pick<Message, "text"> | undefined): { excerpt: string; rest: string } | null {
  if (!quoted) return null
  const got = excerptOf(m.text)
  return got && excerptIn(got.excerpt, quoted.text) ? got : null
}

export interface ThreadReply {
  code: string
  root: number
  to: number
  excerpt: string | null
}

export const threadReply = store<ThreadReply | null>(null)
