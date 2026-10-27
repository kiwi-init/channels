import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react"
import { EnrichedMarkdownText, type EnrichedMarkdownTextProps, type MarkdownStyle } from "react-native-enriched-markdown/lib/module/index.web.js"
import { bridge } from "@/lib/secrets"

import { linked } from "~/chat/linked"
import { Icon } from "~/kit/icons"

const Enriched: (props: EnrichedMarkdownTextProps & { ref?: Ref<HTMLDivElement> }) => ReactNode = EnrichedMarkdownText

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

const FLAGS = { latexMath: false, underline: false }

export interface MarkdownProps {
  text: string
  names: ReadonlyMap<string, string>
  tasks: ReadonlySet<number>
  onMention: (name: string) => void
  onTask: (id: number) => void
  onImage: (url: string, alt: string) => void
  onShown: () => void
  copied: () => void
}

interface Block {
  top: number
  right: number
  code: string
}

export default function Markdown({ text, names, tasks, onMention, onTask, onImage, onShown, copied }: MarkdownProps) {
  const markdown = useMemo(() => linked(text, names, tasks), [text, names, tasks])
  const box = useRef<HTMLDivElement>(null)
  const [blocks, setBlocks] = useState<Block[]>([])

  const measure = useCallback(() => {
    const el = box.current
    if (!el) return
    const at = el.getBoundingClientRect()
    const next = [...el.querySelectorAll("pre")].map((pre) => {
      const r = pre.getBoundingClientRect()
      return { top: r.top - at.top, right: at.right - r.right, code: (pre.textContent ?? "").replace(/\n+$/, "") }
    })
    setBlocks((prev) => (prev.length === next.length && prev.every((b, i) => b.top === next[i]?.top && b.right === next[i]?.right && b.code === next[i]?.code) ? prev : next))
  }, [])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [measure])

  const shown = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      onShown()
      measure()
    },
    [onShown, measure]
  )

  const press = useCallback(
    ({ url }: { url: string }) => {
      if (url.startsWith("kiwi-mention:")) return onMention(decodeURIComponent(url.slice("kiwi-mention:".length)))
      if (url.startsWith("kiwi-task:")) return onTask(Number(url.slice("kiwi-task:".length)))
      if (!/^https?:\/\//i.test(url) && !url.startsWith("mailto:")) return
      const b = bridge()
      if (b) void b.openExternal(url).catch(() => {})
      else window.open(url, "_blank", "noopener,noreferrer")
    },
    [onMention, onTask]
  )

  return (
    <div className="md" ref={box}>
      <Enriched
        ref={shown}
        markdown={markdown}
        markdownStyle={STYLE}
        md4cFlags={FLAGS}
        enableTaskListItemToggle={false}
        onLinkPress={press}
        onImagePress={({ url, altText }) => onImage(url, altText)}
      />
      {blocks.map((b, i) => (
        <button
          key={i}
          type="button"
          className="md-copy"
          style={{ top: b.top + 6, right: b.right + 6 }}
          aria-label="Copy code"
          title="Copy code"
          onClick={() => {
            void navigator.clipboard?.writeText(b.code).then(copied)
          }}
        >
          <Icon name="copy" size={13} />
        </button>
      ))}
    </div>
  )
}
