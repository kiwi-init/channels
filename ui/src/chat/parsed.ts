import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"

const LIMIT = 800
const parsed = new Map<string, ASTNode>()

const DAYLESS = /(?<!\d{4}-\d{2}-\d{2}T)(?<![\d:])\d{2}:\d{2}(?:Z| UTC)(?![\dA-Za-z])/

const ENCODED = /[&\\]/

export const parseKey = (markdown: string, at?: number): string =>
  at === undefined || !(DAYLESS.test(markdown) || ENCODED.test(markdown)) ? markdown : `\u0000${new Date(at).toISOString().slice(0, 10)}\u0000${markdown}`

export const parsedFor = (markdown: string): ASTNode | undefined => parsed.get(markdown)

export function keepParsed(markdown: string, ast: ASTNode): void {
  parsed.delete(markdown)
  parsed.set(markdown, ast)
  const oldest = parsed.size > LIMIT ? parsed.keys().next().value : undefined
  if (oldest !== undefined) parsed.delete(oldest)
}
