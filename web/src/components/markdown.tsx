import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { Children, createContext, isValidElement, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { compareCells, knownRefs, messageRefs, nextSort, Recent, sanitizeMarkdownUrl, type SortDir } from "../lib/markdown"
import { cx } from "../lib/utils"
import { Icon } from "./icon"
import { MermaidBlock } from "./mermaid"

// react-markdown never renders raw HTML. urlTransform also drops any scheme outside the allowlist.
const components: Components = {
  p: ({ children }) => <p className="[&:not(:first-child)]:mt-2">{children}</p>,
  // Links in messages only ever open elsewhere: never an in-app address (those can carry keys).
  a: ({ children, href }) => {
    const safe = typeof href === "string" ? sanitizeMarkdownUrl(href) : undefined
    if (!safe) return <span className="underline decoration-dotted underline-offset-2">{children}</span>
    if (/^https?:\/\//i.test(safe)) {
      return (
        <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="[overflow-wrap:anywhere] text-link underline decoration-link/30 underline-offset-2 hover:decoration-link">
          {children}
        </a>
      )
    }
    return (
      <a href={safe} className="[overflow-wrap:anywhere] text-link underline decoration-link/30 underline-offset-2 hover:decoration-link">
        {children}
      </a>
    )
  },
  // Remote images would tell their host who read the message, and when: show a link instead.
  img: ({ src, alt }) =>
    typeof src === "string" && sanitizeMarkdownUrl(src) && /^https?:\/\//i.test(src) ? (
      <a href={src} target="_blank" rel="noopener noreferrer nofollow" className="text-link underline decoration-link/30 underline-offset-2">
        {alt || "image"} (opens {new URL(src).hostname})
      </a>
    ) : (
      <span>{alt || ""}</span>
    ),
  ul: ({ children }) => <ul className="mt-1.5 ml-5 list-disc space-y-0.5 marker:text-ink-3">{children}</ul>,
  ol: ({ children }) => <ol className="mt-1.5 ml-5 list-decimal space-y-0.5 marker:text-ink-3">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="mt-2 border-l-2 border-line pl-3 text-ink-2">{children}</blockquote>,
  h1: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mt-3 font-semibold first:mt-0">{children}</p>,
  pre: ({ children }) => {
    const source = mermaidSource(children)
    return source === undefined ? <CodeBlock>{children}</CodeBlock> : <MermaidBlock source={source} code={<CodeBlock>{children}</CodeBlock>} />
  },
  code: ({ children, className }) => <InlineCode className={className}>{children}</InlineCode>,
  hr: () => <hr className="my-3 border-line" />,
  table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
  button: ({ children, value }) => (typeof value === "string" && /^[1-9]\d*$/.test(value) ? <MessageRef seq={Number(value)}>{children}</MessageRef> : <span>{children}</span>),
}

function mermaidSource(children: ReactNode): string | undefined {
  const code = Children.toArray(children).find((c) => isValidElement<{ className?: string; children?: ReactNode }>(c))
  if (!isValidElement<{ className?: string; children?: ReactNode }>(code) || !/\blanguage-mermaid\b/.test(code.props.className ?? "")) return undefined
  const text = Children.toArray(code.props.children)
    .filter((c) => typeof c === "string")
    .join("")
  return text.trim() ? text : undefined
}

const COPYABLE = 16

function InlineCode({ children, className }: { children?: ReactNode; className?: string }) {
  const timer = useRef<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const text = Children.toArray(children)
    .filter((c) => typeof c === "string")
    .join("")
  const look = "rounded-row bg-wash-2 px-1 py-px font-mono text-[0.86em]"
  if (className || text.length < COPYABLE || text.includes("\n")) return <code className={look}>{children}</code>
  return (
    <button
      type="button"
      title={copied ? "Copied" : "Copy"}
      aria-label={`Copy ${text}`}
      onClick={() => {
        if (!navigator.clipboard) return
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true)
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => {})
      }}
      className="inline cursor-copy text-left [overflow-wrap:anywhere] hover:bg-wash-2 focus-visible:outline-2"
    >
      <code className={look}>{children}</code>
      {copied && <span className="ml-1 text-stamp text-ink-3">Copied</span>}
    </button>
  )
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // Lines wider than the bubble scroll sideways; while there's more to the right, the edge fades, so a
  // cut-off line reads as "scroll for more" rather than as the end of it.
  const [more, setMore] = useState(false)
  const measure = useCallback(() => {
    const el = preRef.current
    if (el) setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2)
  }, [])
  useEffect(() => {
    const el = preRef.current
    if (!el) return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [measure])
  return (
    <div className="group relative my-2">
      {/* On a phone, long lines wrap rather than run off the edge with no sign there's more. */}
      <pre
        ref={preRef}
        onScroll={measure}
        className={cx(
          "overflow-x-auto rounded-ctl bg-wash-2 px-3 py-2.5 font-mono text-ui leading-relaxed text-ink max-sm:break-all max-sm:whitespace-pre-wrap [&>code]:bg-transparent [&>code]:p-0",
          more && "code-more"
        )}
      >
        {children}
      </pre>
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy code"}
        className="absolute top-1.5 right-1.5 inline-flex size-7 items-center justify-center rounded-row text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-wash-2 hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        onClick={() => {
          const text = preRef.current?.innerText ?? ""
          if (!text || !navigator.clipboard) return
          navigator.clipboard
            .writeText(text)
            .then(() => {
              setCopied(true)
              window.clearTimeout(timer.current)
              timer.current = window.setTimeout(() => setCopied(false), 1500)
            })
            .catch(() => {})
        }}
      >
        <Icon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
      </button>
    </div>
  )
}

type Sort = { column: number; direction: SortDir } | null

function MarkdownTable({ children }: { children?: ReactNode }) {
  const { headers, rows } = useMemo(() => extractTable(children), [children])
  const [sort, setSort] = useState<Sort>(null)
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])
  if (headers.length === 0) {
    return (
      <div className="my-2 overflow-x-auto">
        <table className="text-ui">{children}</table>
      </div>
    )
  }
  return (
    <div className="my-2 overflow-x-auto">
      <table className="text-ui [&_td]:border-b [&_td]:border-line [&_td]:py-1 [&_td]:pr-4 [&_th]:border-b [&_th]:border-line [&_th]:py-1 [&_th]:pr-4 [&_th]:text-left [&_th]:font-semibold">
        <thead>
          <tr>
            {headers.map((header, index) => {
              const direction = sort?.column === index ? sort.direction : null
              const label = cellText(header) || `column ${index + 1}`
              return (
                <th key={index} scope="col" aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-left font-semibold hover:text-ink focus-visible:[outline-offset:-2px]"
                    aria-label={`Sort by ${label}`}
                    onClick={() => setSort((current) => nextSort(current, index))}
                  >
                    {header}
                    <span aria-hidden className="text-meta text-ink-3">
                      {direction === "asc" ? "↑" : direction === "desc" ? "↓" : ""}
                    </span>
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {headers.map((_, columnIndex) => (
                <td key={columnIndex}>{row[columnIndex] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function sortRows(rows: ReactNode[][], sort: Sort): ReactNode[][] {
  if (!sort) return rows
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const compared = compareCells(cellText(a.row[sort.column]), cellText(b.row[sort.column]))
      if (compared === 0) return a.index - b.index
      return sort.direction === "asc" ? compared : -compared
    })
    .map((item) => item.row)
}

function extractTable(children: ReactNode): { headers: ReactNode[]; rows: ReactNode[][] } {
  const headers: ReactNode[] = []
  const rows: ReactNode[][] = []
  const walk = (node: ReactNode) => {
    for (const child of Children.toArray(node)) {
      if (!isCellElement(child)) continue
      if (child.type === "tr") {
        const th = cells(child, "th")
        const td = cells(child, "td")
        if (th.length > 0 && headers.length === 0) headers.push(...th)
        else if (td.length > 0) rows.push(td)
      } else walk(child.props.children)
    }
  }
  walk(children)
  return { headers, rows }
}

function cells(row: ReactElement<{ children?: ReactNode }>, type: "th" | "td"): ReactNode[] {
  return Children.toArray(row.props.children)
    .filter((cell): cell is ReactElement<{ children?: ReactNode }> => isCellElement(cell) && cell.type === type)
    .map((cell) => cell.props.children)
}

function isCellElement(node: ReactNode): node is ReactElement<{ children?: ReactNode }> {
  return isValidElement<{ children?: ReactNode }>(node)
}

function cellText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(cellText).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return cellText(node.props.children)
  return ""
}

export type MessageRefs = { known: (seq: number) => boolean; open: (seq: number) => void }

const OpenRef = createContext<((seq: number) => void) | undefined>(undefined)

function MessageRef({ seq, children }: { seq: number; children?: ReactNode }) {
  const open = useContext(OpenRef)
  return (
    <button type="button" data-ref="" onClick={() => open?.(seq)} className="text-link underline decoration-link/30 underline-offset-2 hover:decoration-link">
      {children}
    </button>
  )
}

type MdNode = { type: string; value?: string; data?: { hName?: string; hProperties?: Record<string, string> }; children?: MdNode[] }

const OPAQUE = new Set(["link", "linkReference", "definition", "code", "inlineCode", "html"])

function linkMessageRefs(node: MdNode, known: (seq: number) => boolean): void {
  if (!node.children || OPAQUE.has(node.type)) return
  if (node.type === "table") {
    for (const row of node.children.slice(1)) linkMessageRefs(row, known)
    return
  }
  node.children = node.children.flatMap((child): MdNode[] => {
    if (child.type !== "text" || child.value === undefined) {
      linkMessageRefs(child, known)
      return [child]
    }
    const parts = messageRefs(child.value, known)
    if (parts.length === 1 && parts[0]?.kind === "text") return [child]
    return parts.map((part) =>
      part.kind === "text"
        ? { type: "text", value: part.text }
        : { type: "messageRef", data: { hName: "button", hProperties: { value: String(part.seq) } }, children: [{ type: "text", value: part.text }] }
    )
  })
}

const PLAIN = [remarkGfm, remarkBreaks]
const urlTransform = (url: string) => sanitizeMarkdownUrl(url) ?? ""
const rendered = new Recent<ReactElement>(500)

export function renderMarkdown(body: string, known?: (seq: number) => boolean): ReactElement {
  const linked = known ? knownRefs(body, known) : ""
  const key = `${linked}\u0000${body}`
  const hit = rendered.get(key)
  if (hit) return hit
  const ids = new Set(linked ? linked.split(",").map(Number) : [])
  const plugins = ids.size ? [...PLAIN, () => (tree: MdNode) => linkMessageRefs(tree, (seq) => ids.has(seq))] : PLAIN
  const tree = ReactMarkdown({ skipHtml: true, remarkPlugins: plugins, components, urlTransform, children: body })
  rendered.set(key, tree)
  return tree
}

export const Markdown = memo(function Markdown({ children, refs }: { children: string; refs?: MessageRefs }) {
  const known = refs?.known
  const tree = useMemo(() => renderMarkdown(children, known), [children, known])
  return (
    <div className="[overflow-wrap:anywhere] break-words">
      <OpenRef.Provider value={refs?.open}>{tree}</OpenRef.Provider>
    </div>
  )
})
