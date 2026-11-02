import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react"
import type { MarkdownStyle } from "react-native-enriched-markdown/lib/module/index.web.js"
import { normalizeMarkdownStyle } from "react-native-enriched-markdown/lib/module/normalizeMarkdownStyle.web.js"
import { ENRM_TEXT_CLASS } from "react-native-enriched-markdown/lib/module/web/globalStyles.js"
import { parseMarkdown } from "react-native-enriched-markdown/lib/module/web/parseMarkdown.js"
import { RenderNode } from "react-native-enriched-markdown/lib/module/web/renderers/index.js"
import { buildStyles, tableBodyRowStyle, zeroTrailingMargins } from "react-native-enriched-markdown/lib/module/web/styles.js"
import { indexTaskItems, markInlineImages } from "react-native-enriched-markdown/lib/module/web/utils.js"
import type { ASTNode, RendererCallbacks } from "react-native-enriched-markdown/lib/typescript/src/web/types"
import { compareCells, nextSort, sanitizeMarkdownUrl, type SortDir } from "@kiwi/app/markdown.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"

import { MermaidBlock } from "~/chat/mermaid"
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

const OWN_LINK = /^kiwi-(?:mention|task|msg):/
const OPENED = /^(?:https?:\/\/|mailto:)/i
const LOCAL_PICTURE = /^(?:data|blob):/i

const opened = (url: string): boolean => OWN_LINK.test(url) || (OPENED.test(url.trim()) && !!sanitizeMarkdownUrl(url))

function pictureLink(node: ASTNode, inLink: boolean): void {
  const url = node.attributes?.url ?? ""
  const safe = !inLink && /^https?:\/\//i.test(url.trim()) ? sanitizeMarkdownUrl(url) : undefined
  const alt = textOf(node) || "image"
  node.type = safe ? "Link" : "Text"
  node.attributes = safe ? { url: safe } : {}
  if (safe) node.children = [{ type: "Text", content: `${alt} (opens ${new URL(safe).hostname})` }]
  else {
    node.content = alt
    node.children = []
  }
}

export function safeLinks(node: ASTNode, inLink = false): void {
  const url = node.attributes?.url
  if (node.type === "Image" && !LOCAL_PICTURE.test(url?.trim() ?? "")) pictureLink(node, inLink)
  else if (node.type === "Link" && url !== undefined && !opened(url)) delete node.attributes?.url
  for (const child of node.children ?? []) safeLinks(child, inLink || node.type === "Link")
}

function parse(markdown: string): Promise<ASTNode> {
  const done = parsedFor(markdown)
  if (done) return Promise.resolve(done)
  const pending = parsing.get(markdown)
  if (pending) return pending
  const next = parseMarkdown(markdown, FLAGS)
    .then((ast) => {
      indexTaskItems(ast)
      markInlineImages(ast)
      safeLinks(ast)
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

type Sort = { column: number; direction: SortDir } | null

const textOf = (node: ASTNode): string => node.content ?? (node.children ?? []).map(textOf).join("")

export function sortedRows(rows: readonly ASTNode[], sort: Sort): number[] {
  const order = rows.map((_, i) => i)
  if (!sort) return order
  const texts = rows.map((row) => textOf(row.children?.[sort.column] ?? { type: "Text" }))
  return order.sort((a, b) => {
    const compared = compareCells(texts[a] ?? "", texts[b] ?? "")
    if (compared === 0) return a - b
    return sort.direction === "asc" ? compared : -compared
  })
}

export function mermaidSource(node: ASTNode): string | undefined {
  if (node.type !== "CodeBlock" || node.attributes?.language?.trim().toLowerCase() !== "mermaid") return undefined
  const text = textOf(node)
  return text.trim() ? text : undefined
}

type Style = typeof NORMAL

function Table({ node, style, styles, callbacks }: { node: ASTNode; style: Style; styles: Styles; callbacks: RendererCallbacks }) {
  const [sort, setSort] = useState<Sort>(null)
  const head = node.children?.find((c) => c.type === "TableHead")?.children?.[0]?.children ?? []
  const body = useMemo(() => node.children?.find((c) => c.type === "TableBody")?.children ?? [], [node])
  const order = useMemo(() => sortedRows(body, sort), [body, sort])
  const inside = (cell: ASTNode) =>
    cell.children?.map((child, i) => <RenderNode key={i} node={child} style={style} styles={styles} callbacks={callbacks} capabilities={CAPABILITIES} parentType={cell.type} index={i} />)
  return (
    <div style={styles.tableWrapper}>
      <table style={styles.table}>
        <thead>
          <tr>
            {head.map((cell, i) => {
              const direction = sort?.column === i ? sort.direction : null
              return (
                <th
                  key={i}
                  scope="col"
                  style={styles.tableHeaderCell[cell.attributes?.align ?? "default"]}
                  aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
                >
                  <button type="button" className="md-sort" aria-label={`Sort by ${textOf(cell) || `column ${i + 1}`}`} onClick={() => setSort((was) => nextSort(was, i))}>
                    {inside(cell)}
                    <span aria-hidden="true">{direction === "asc" ? "↑" : direction === "desc" ? "↓" : ""}</span>
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {order.map((at, r) => (
            <tr key={at} style={tableBodyRowStyle(style, r)}>
              {body[at]?.children?.map((cell, c) => (
                <td key={c} style={styles.tableCell[cell.attributes?.align ?? "default"]}>
                  {inside(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const COPYABLE = 16

const scrollsOn = (pre: HTMLElement) => pre.classList.toggle("code-more", pre.scrollWidth - pre.clientWidth - pre.scrollLeft > 2)

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
    for (const code of box.current?.querySelectorAll<HTMLElement>("code") ?? []) {
      const text = code.textContent ?? ""
      if (code.closest("pre, a") || text.length < COPYABLE || text.includes("\n")) continue
      code.dataset.copy = ""
      code.setAttribute("role", "button")
      code.tabIndex = 0
      code.title = "Copy"
      code.setAttribute("aria-label", `Copy ${text}`)
    }
  }, [ast])

  useLayoutEffect(() => {
    const pres = box.current?.querySelectorAll<HTMLElement>("pre") ?? []
    if (pres.length === 0) return
    const watch = new ResizeObserver((seen) => {
      for (const { target } of seen) if (target instanceof HTMLElement) scrollsOn(target)
    })
    for (const pre of pres) watch.observe(pre)
    return () => watch.disconnect()
  }, [ast])

  const scrolled = useCallback((e: { target: EventTarget }) => {
    if (e.target instanceof HTMLPreElement) scrollsOn(e.target)
  }, [])

  const copyCode = useCallback(
    (target: EventTarget) => {
      const code = target instanceof Element ? target.closest<HTMLElement>("code[data-copy]") : null
      if (!code || !box.current?.contains(code)) return false
      void navigator.clipboard?.writeText(code.textContent ?? "").then(copied, () => {})
      return true
    },
    [copied]
  )
  const clicked = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return
      copyCode(e.target)
    },
    [copyCode]
  )
  const keyed = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.repeat || (e.key !== "Enter" && e.key !== " ")) return
      if (copyCode(e.target)) e.preventDefault()
    },
    [copyCode]
  )

  const press = useCallback(
    ({ url }: { url: string }) => {
      if (url.startsWith("kiwi-mention:")) return onMention(decodeURIComponent(url.slice("kiwi-mention:".length)))
      if (url.startsWith("kiwi-task:")) return onTask(Number(url.slice("kiwi-task:".length)))
      if (url.startsWith("kiwi-msg:")) return onMessage(Number(url.slice("kiwi-msg:".length)))
      if (!sanitizeMarkdownUrl(url) || (!/^https?:\/\//i.test(url) && !url.startsWith("mailto:"))) return
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
    <div className="md" ref={box} onClick={clicked} onKeyDown={keyed} onScrollCapture={scrolled}>
      {ast && (
        <div className={ENRM_TEXT_CLASS} style={WRAP} ref={shown}>
          {children.map((child, i) => {
            const last = i === children.length - 1
            const source = mermaidSource(child)
            if (source !== undefined)
              return (
                <MermaidBlock
                  key={`${child.type}-${i}`}
                  source={source}
                  onLink={(url) => press({ url })}
                  copied={copied}
                  code={<RenderNode node={child} style={last ? LAST : NORMAL} styles={last ? LAST_STYLES : STYLES} callbacks={callbacks} capabilities={CAPABILITIES} />}
                />
              )
            return child.type === "Table" ? (
              <Table key={`${child.type}-${i}`} node={child} style={last ? LAST : NORMAL} styles={last ? LAST_STYLES : STYLES} callbacks={callbacks} />
            ) : (
              <RenderNode key={`${child.type}-${i}`} node={child} style={last ? LAST : NORMAL} styles={last ? LAST_STYLES : STYLES} callbacks={callbacks} capabilities={CAPABILITIES} />
            )
          })}
        </div>
      )}
    </div>
  )
}
