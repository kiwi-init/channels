import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"

const LIMIT = 800
const parsed = new Map<string, ASTNode>()

export const parsedFor = (markdown: string): ASTNode | undefined => parsed.get(markdown)

export function keepParsed(markdown: string, ast: ASTNode): void {
  parsed.delete(markdown)
  parsed.set(markdown, ast)
  const oldest = parsed.size > LIMIT ? parsed.keys().next().value : undefined
  if (oldest !== undefined) parsed.delete(oldest)
}
