import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import type { MarkdownStyle } from "react-native-enriched-markdown/lib/module/index.web.js"
import { normalizeMarkdownStyle } from "react-native-enriched-markdown/lib/module/normalizeMarkdownStyle.web.js"
import { ENRM_TEXT_CLASS } from "react-native-enriched-markdown/lib/module/web/globalStyles.js"
import { parseMarkdown } from "react-native-enriched-markdown/lib/module/web/parseMarkdown.js"
import { RenderNode } from "react-native-enriched-markdown/lib/module/web/renderers/index.js"
import { buildStyles, zeroTrailingMargins } from "react-native-enriched-markdown/lib/module/web/styles.js"
import { indexTaskItems, markInlineImages } from "react-native-enriched-markdown/lib/module/web/utils.js"
import type { ASTNode } from "react-native-enriched-markdown/lib/typescript/src/web/types"
import { bridge } from "@/lib/secrets"

import { keepParsed, parsedFor } from "~/chat/parsed"

const TEXT = { fontSize: 15, fontFamily: "var(--sans)", color: "var(--ink)", lineHeight: 22, marginTop: 0, marginBottom: 8 }
const HEAD = { fontFamily: "var(--sans)", fontWeight: "600", color: "var(--ink)", marginTop: 6, marginBottom: 4 }

const STYLE: MarkdownStyle = {
  paragraph: TEXT,
  h1: { ...HEAD, fontSize: 19, lineHeight: 26 },
  h2: { ...HEAD, fontSize: 17, lineHeight: 24 },
  h3: { ...HEAD, fontSize: 15, lineHeight: 22 },
  h4: { ...HEAD, fontSize: 15, lineHeight: 22 },
  h5: { ...HEAD, fontSize: 14, lineHeight: 20, color: "var(--ink-2)" },
  h6: { ...HEAD, fontSize: 14, lineHeight: 20, color: "var(--ink-2)" },
  blockquote: {
    ...TEXT,
    color: "var(--ink-2)",
    borderColor: "var(--line-3)",
    borderWidth: 2,
    gapWidth: 12,
    backgroundColor: "transparent",
    padding: 0,
    admonitions: {
      note: { color: "var(--accent)", backgroundColor: "var(--accent-wash)" },
      tip: { color: "var(--live)", backgroundColor: "var(--wash)" },
      important: { color: "var(--review)", backgroundColor: "var(--wash)" },
      warning: { color: "var(--decide)", backgroundColor: "var(--decide-wash)" },
      caution: { color: "var(--alert)", backgroundColor: "var(--alert-wash)" },
    },
  },
  list: { ...TEXT, bulletColor: "var(--ink-3)", bulletSize: 5, markerColor: "var(--ink-3)", markerFontWeight: "500", gapWidth: 6, marginLeft: 22, itemSpacing: 2 },
  codeBlock: {
    fontSize: 12.5,
    fontFamily: "var(--mono)",
    color: "var(--ink)",
    lineHeight: 19,
    marginTop: 2,
    marginBottom: 8,
    backgroundColor: "var(--raise)",
    borderColor: "transparent",
    borderWidth: 0,
    borderRadius: 10,
    padding: 12,
  },
  link: { color: "var(--accent)", underline: false },
  linkVariants: {
    "^kiwi-mention:": { color: "var(--accent)", underline: false },
    "^kiwi-task:": { color: "var(--ink)", underline: true },
    "^kiwi-msg:": { color: "var(--ink)", underline: true },
  },
  strong: { color: "var(--ink)" },
  em: { color: "var(--ink)" },
  strikethrough: { color: "var(--ink-3)" },
  code: { fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink)", backgroundColor: "var(--wash-2)", borderColor: "transparent" },
  image: { maxHeight: 360, borderRadius: 10, marginTop: 2, marginBottom: 8, resizeMode: "contain" },
  thematicBreak: { color: "transparent", height: 1, marginTop: 14, marginBottom: 14 },
  table: {
    fontSize: 14,
    fontFamily: "var(--sans)",
    color: "var(--ink)",
    lineHeight: 20,
    marginTop: 2,
    marginBottom: 8,
    headerBackgroundColor: "var(--raise)",
    headerTextColor: "var(--ink)",
    rowEvenBackgroundColor: "var(--wash)",
    rowOddBackgroundColor: "transparent",
    borderColor: "transparent",
    borderWidth: 0,
    borderRadius: 10,
    cellPaddingHorizontal: 10,
    cellPaddingVertical: 6,
  },
  taskList: { checkedColor: "var(--accent)", borderColor: "var(--line-3)", checkmarkColor: "var(--on-ink)", checkedTextColor: "var(--ink-2)" },
}

const FLAGS = { latexMath: false, underline: false, hardSoftBreaks: true }

type Styles = ReturnType<typeof buildStyles>

const scaled = (px: number) => `calc(${px}px * var(--text-scale, 1))`

function sized(s: CSSProperties): CSSProperties {
  const line = typeof s.lineHeight === "string" ? /^(\d+(?:\.\d+)?)px$/.exec(s.lineHeight)?.[1] : undefined
  return { ...s, ...(typeof s.fontSize === "number" ? { fontSize: scaled(s.fontSize) } : {}), ...(line ? { lineHeight: scaled(Number(line)) } : {}) }
}

const sizedCells = (cells: Styles["tableCell"]): Styles["tableCell"] => ({ left: sized(cells.left), center: sized(cells.center), right: sized(cells.right), default: sized(cells.default) })

export function withTextSize(s: Styles): Styles {
  return {
    ...s,
    paragraph: sized(s.paragraph),
    paragraphInBlockquote: sized(s.paragraphInBlockquote),
    h1: sized(s.h1),
    h2: sized(s.h2),
    h3: sized(s.h3),
    h4: sized(s.h4),
    h5: sized(s.h5),
    h6: sized(s.h6),
    blockquote: sized(s.blockquote),
    list: sized(s.list),
    listNested: sized(s.listNested),
    listTask: sized(s.listTask),
    codeBlock: sized(s.codeBlock),
    codeBlockFont: sized(s.codeBlockFont),
    code: sized(s.code),
    mathInline: sized(s.mathInline),
    mathDisplay: sized(s.mathDisplay),
    table: sized(s.table),
    tableHeaderCell: sizedCells(s.tableHeaderCell),
    tableCell: sizedCells(s.tableCell),
  }
}

const NORMAL = normalizeMarkdownStyle(STYLE)
const LAST = zeroTrailingMargins(NORMAL)
const STYLES = withTextSize(buildStyles(NORMAL))
const LAST_STYLES = withTextSize(buildStyles(LAST))
const CAPABILITIES = { katex: null, enableTaskListItemToggle: false }
const WRAP: CSSProperties = { display: "flex", flexDirection: "column" }

const parsing = new Map<string, Promise<ASTNode>>()

function parse(markdown: string): Promise<ASTNode> {
  const done = parsedFor(markdown)
  if (done) return Promise.resolve(done)
  const pending = parsing.get(markdown)
  if (pending) return pending
  const next = parseMarkdown(markdown, FLAGS)
    .then((ast) => {
      indexTaskItems(ast)
      markInlineImages(ast)
      keepParsed(markdown, ast)
      return ast
    })
    .finally(() => parsing.delete(markdown))
  parsing.set(markdown, next)
  return next
}

export function warm<T>(texts: readonly T[], link: (text: T) => string): () => void {
  const queue = [...texts]
  let timer = 0
  const step = () => {
    const text = queue.shift()
    if (text === undefined) return
    void parse(link(text))
      .catch(() => {
        // A message that doesn't parse shows its plain text when it's rendered; warming skips it.
      })
      .finally(() => {
        timer = window.setTimeout(step, 0)
      })
  }
  timer = window.setTimeout(step, 0)
  return () => {
    queue.length = 0
    window.clearTimeout(timer)
  }
}

export interface MarkdownProps {
  markdown: string
  onMention: (name: string) => void
  onTask: (id: number) => void
  onMessage: (seq: number) => void
  onImage: (url: string, alt: string) => void
  onShown: () => void
  copied: () => void
}

export default function Markdown({ markdown, onMention, onTask, onMessage, onImage, onShown, copied }: MarkdownProps) {
  const box = useRef<HTMLDivElement>(null)
  const [got, setGot] = useState<{ markdown: string; ast: ASTNode } | null>(() => {
    const cached = parsedFor(markdown)
    return cached ? { markdown, ast: cached } : null
  })
  const ast = got?.markdown === markdown ? got.ast : (parsedFor(markdown) ?? null)

  useEffect(() => {
    let live = true
    parse(markdown)
      .then((next) => {
        if (live) setGot((was) => (was?.markdown === markdown ? was : { markdown, ast: next }))
      })
      .catch(() => {
        // The plain text stays on screen when the markdown doesn't parse.
      })
    return () => {
      live = false
    }
  }, [markdown])

  const shown = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) onShown()
    },
    [onShown]
  )

  useLayoutEffect(() => {
    for (const a of box.current?.querySelectorAll<HTMLAnchorElement>('a[href^="kiwi-mention:"]') ?? []) {
      try {
        a.title = `@${decodeURIComponent((a.getAttribute("href") ?? "").slice("kiwi-mention:".length))}`
      } catch {
        // A mention link someone wrote by hand with a stray %: it keeps no hover text.
      }
    }
  }, [ast])

  const press = useCallback(
    ({ url }: { url: string }) => {
      if (url.startsWith("kiwi-mention:")) return onMention(decodeURIComponent(url.slice("kiwi-mention:".length)))
      if (url.startsWith("kiwi-task:")) return onTask(Number(url.slice("kiwi-task:".length)))
      if (url.startsWith("kiwi-msg:")) return onMessage(Number(url.slice("kiwi-msg:".length)))
      if (!/^https?:\/\//i.test(url) && !url.startsWith("mailto:")) return
      const b = bridge()
      if (b) void b.openExternal(url).catch(() => {})
      else window.open(url, "_blank", "noopener,noreferrer")
    },
    [onMention, onTask, onMessage]
  )
  const callbacks = useMemo(
    () => ({
      onLinkPress: press,
      onImagePress: ({ url, altText }: { url: string; altText: string }) => onImage(url, altText),
      onCodeBlockPress: ({ code }: { code: string }) => {
        void navigator.clipboard?.writeText(code).then(copied, () => {})
      },
    }),
    [press, onImage, copied]
  )
  const children = ast?.children ?? []

  return (
    <div className="md" ref={box}>
      {ast && (
        <div className={ENRM_TEXT_CLASS} style={WRAP} ref={shown}>
          {children.map((child, i) => (
            <RenderNode
              key={`${child.type}-${i}`}
              node={child}
              style={i === children.length - 1 ? LAST : NORMAL}
              styles={i === children.length - 1 ? LAST_STYLES : STYLES}
              callbacks={callbacks}
              capabilities={CAPABILITIES}
            />
          ))}
        </div>
      )}
    </div>
  )
}
