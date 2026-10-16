import type { Root } from "mdast"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import remarkParse from "remark-parse"
import { unified } from "unified"

export { compareCells, nextSort, type SortDir } from "@web/lib/markdown"

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel"])

export function safeUrl(url: string): string | undefined {
  const value = url.trim()
  if (!value) return undefined
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f) return undefined
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase()
  if (!scheme || !SAFE_SCHEMES.has(scheme)) return undefined
  if (scheme === "http" || scheme === "https") {
    const authority = /^[a-z]+:\/\/([^/?#]*)/i.exec(value)?.[1]
    if (authority === undefined || authority.includes("@")) return undefined
    if (!hostOf(value)) return undefined
  }
  return value
}

export function hostOf(url: string): string | undefined {
  const authority = /^[a-z]+:\/\/([^/?#]*)/i.exec(url)?.[1]
  const host = authority?.replace(/:\d*$/, "")
  return host ? host.toLowerCase() : undefined
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkBreaks)

export function parseMarkdown(text: string): Root {
  return processor.parse(text)
}
