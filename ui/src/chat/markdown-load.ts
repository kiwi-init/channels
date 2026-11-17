import type Markdown from "~/chat/markdown"

type MarkdownView = typeof Markdown

let loaded: MarkdownView | null = null

export const markdownNow = (): MarkdownView | null => loaded

export const loadMarkdown = (): Promise<typeof import("~/chat/markdown")> =>
  import("~/chat/markdown").then((m) => {
    loaded = m.default
    return m
  })
