import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"

type MarkdownModule = typeof import("~/chat/markdown")

let loaded: MarkdownModule | null = null

export const markdownNow = (): MarkdownModule["default"] | null => loaded?.default ?? null

export const parsedOnceLoaded = (markdown: string, at?: number): ASTNode | undefined => loaded?.parsedNow(markdown, at)

export const loadMarkdown = (): Promise<MarkdownModule> =>
  import("~/chat/markdown").then((m) => {
    loaded = m
    return m
  })
