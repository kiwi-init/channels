import { Copy01Icon, Flowchart01Icon, CodeSquareIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { cx } from "../lib/utils"
import { Icon } from "./icon"

type Mermaid = (typeof import("mermaid"))["default"]
type Drawn = { kind: "svg"; svg: string } | { kind: "error"; message: string } | null

let mermaid: Promise<Mermaid> | undefined
const load = () => (mermaid ??= import("mermaid").then((m) => m.default))

const CSS = [
  "* { filter: none !important; }",
  ".node rect, .node polygon, .node path, rect.actor, rect.note, .labelBox { stroke-width: 1px; }",
  ".node rect, rect.actor, rect.note { rx: 6px; ry: 6px; }",
  ".flowchart-link, .messageLine0, .messageLine1, .actor-line { stroke-width: 1px; }",
].join("\n")

let queue: Promise<unknown> = Promise.resolve()
let next = 0

const MIN_SCALE = 0.7

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif'

function resolver(): { color: (token: string) => string; done: () => void } {
  const probe = document.createElement("span")
  probe.style.display = "none"
  document.body.append(probe)
  const ctx = document.createElement("canvas").getContext("2d")
  return {
    color: (token) => {
      probe.style.color = `var(--${token})`
      const computed = getComputedStyle(probe).color
      if (!ctx) return computed
      ctx.fillStyle = "#000"
      ctx.fillStyle = computed
      return String(ctx.fillStyle)
    },
    done: () => probe.remove(),
  }
}

function themeVariables(): Record<string, string> {
  const { color: c, done } = resolver()
  const v = {
    background: c("raised"),
    mainBkg: c("field"),
    primaryColor: c("field"),
    primaryTextColor: c("ink"),
    primaryBorderColor: c("ink-3"),
    secondaryColor: c("accent-wash"),
    secondaryTextColor: c("ink"),
    secondaryBorderColor: c("accent"),
    tertiaryColor: c("raised"),
    tertiaryTextColor: c("ink"),
    tertiaryBorderColor: c("line"),
    nodeBorder: c("ink-3"),
    nodeTextColor: c("ink"),
    textColor: c("ink-2"),
    lineColor: c("ink-3"),
    edgeLabelBackground: c("raised"),
    clusterBkg: c("rail"),
    clusterBorder: c("line"),
    titleColor: c("ink"),
    actorBkg: c("field"),
    actorBorder: c("ink-3"),
    actorTextColor: c("ink"),
    actorLineColor: c("ink-3"),
    signalColor: c("ink-2"),
    signalTextColor: c("ink"),
    labelBoxBkgColor: c("field"),
    labelBoxBorderColor: c("ink-3"),
    labelTextColor: c("ink"),
    loopTextColor: c("ink-2"),
    noteBkgColor: c("accent-wash"),
    noteBorderColor: c("accent"),
    noteTextColor: c("ink"),
    activationBkgColor: c("field"),
    activationBorderColor: c("ink-3"),
    sequenceNumberColor: c("accent-ink"),
    fontFamily: FONT,
    fontSize: "13px",
  }
  done()
  return v
}

export function errorLine(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e)
  return (
    text
      .split("\n")
      .find((l) => l.trim())
      ?.trim()
      .replace(/:\s*$/, "") || "it isn’t valid Mermaid"
  )
}

export function linksApart(svg: string): string {
  return svg.replace(
    /<a\b([^>]*?)(\/?)>/g,
    (_, attrs: string, close: string) => `<a${attrs.replace(/\s(?:target|rel)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, "")} target="_blank" rel="noopener noreferrer"${close}>`
  )
}

function draw(source: string): Promise<Drawn> {
  const run = queue.then(async (): Promise<Drawn> => {
    const m = await load()
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: themeVariables(),
      fontFamily: FONT,
      look: "classic",
      layout: "dagre",
      themeCSS: CSS,
      state: { layout: "dagre" },
      flowchart: { useMaxWidth: false, curve: "basis", padding: 8, nodeSpacing: 24, rankSpacing: 28, diagramPadding: 4 },
      sequence: {
        useMaxWidth: false,
        actorMargin: 24,
        width: 112,
        height: 36,
        boxMargin: 6,
        boxTextMargin: 4,
        noteMargin: 6,
        messageMargin: 26,
        diagramMarginX: 4,
        diagramMarginY: 4,
        mirrorActors: false,
        actorFontFamily: FONT,
        actorFontSize: 13,
        messageFontFamily: FONT,
        messageFontSize: 13,
        messageFontWeight: 400,
        noteFontFamily: FONT,
        noteFontSize: 13,
      },
    })
    try {
      await m.parse(source)
      const { svg } = await m.render(`kiwi-mermaid-${next++}`, source)
      return { kind: "svg", svg: linksApart(svg) }
    } catch (e) {
      return { kind: "error", message: errorLine(e) }
    }
  })
  queue = run.catch(() => undefined)
  return run
}

const MAX_SOURCE = 20_000
const MAX_DRAWN = 100
const drawings = new Map<string, Promise<Drawn>>()

export function drawCached(source: string, scheme: string, render: (source: string) => Promise<Drawn> = draw): Promise<Drawn> {
  const key = `${scheme}\u0000${source}`
  const held = drawings.get(key)
  if (held) {
    drawings.delete(key)
    drawings.set(key, held)
    return held
  }
  const fresh = source.length > MAX_SOURCE ? Promise.resolve<Drawn>({ kind: "error", message: `it's too long to draw (over ${MAX_SOURCE.toLocaleString("en")} characters)` }) : render(source)
  drawings.set(key, fresh)
  if (drawings.size > MAX_DRAWN) drawings.delete(drawings.keys().next().value!)
  return fresh
}

function useScheme(): string {
  const read = () => `${document.documentElement.dataset.theme ?? ""}:${window.matchMedia("(prefers-color-scheme: dark)").matches}`
  const [scheme, setScheme] = useState("")
  useEffect(() => {
    const update = () => setScheme(read())
    update()
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    media.addEventListener("change", update)
    const watch = new MutationObserver(update)
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => {
      media.removeEventListener("change", update)
      watch.disconnect()
    }
  }, [])
  return scheme
}

export function MermaidBlock({ source, code }: { source: string; code: ReactNode }) {
  const scheme = useScheme()
  const [drawn, setDrawn] = useState<Drawn>(null)
  const [showCode, setShowCode] = useState(false)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const box = useRef<HTMLElement>(null)
  const near = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined")
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = near.current
    if (visible || !el) return
    const watch = new IntersectionObserver(
      (seen) => {
        if (!seen.some((e) => e.isIntersecting)) return
        setVisible(true)
        watch.disconnect()
      },
      { rootMargin: "600px 0px" }
    )
    watch.observe(el)
    return () => watch.disconnect()
  }, [visible])
  const measure = () => {
    const el = box.current
    if (el) setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 2)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useLayoutEffect(() => {
    const el = box.current
    const svg = el?.querySelector("svg")
    if (!el || !svg) return
    const natural = svg.viewBox.baseVal.width || svg.getBoundingClientRect().width
    const fit = () => {
      const room = el.clientWidth - 24
      const scale = Math.max(MIN_SCALE, Math.min(1, room / natural))
      svg.style.width = `${natural * scale}px`
      svg.style.height = "auto"
      measure()
    }
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(el)
    return () => watch.disconnect()
  }, [drawn, showCode])
  useEffect(() => {
    if (!scheme || !visible) return
    let live = true
    void drawCached(source, scheme).then((d) => live && setDrawn(d))
    return () => {
      live = false
    }
  }, [source, scheme, visible])

  if (drawn?.kind === "error") {
    return (
      <div>
        {code}
        <p className="-mt-1 mb-2 flex items-center gap-1 text-meta">
          <Icon icon={Flowchart01Icon} size={12} />
          <span>Couldn’t draw this Mermaid diagram: {drawn.message}</span>
        </p>
      </div>
    )
  }
  if (!drawn || showCode) {
    return (
      <div ref={near} className="group/mermaid relative">
        {code}
        {drawn && (
          <button
            type="button"
            aria-label="Show diagram"
            className="absolute top-1.5 right-9 inline-flex size-7 items-center justify-center rounded-row text-ink-3 opacity-0 transition-opacity group-hover/mermaid:opacity-100 hover:bg-wash-2 hover:text-ink focus-visible:opacity-100"
            onClick={() => setShowCode(false)}
          >
            <Icon icon={Flowchart01Icon} size={14} />
          </button>
        )}
      </div>
    )
  }
  return (
    <figure ref={box} onScroll={measure} className={cx("group relative my-2 overflow-x-auto rounded-ctl bg-raised px-3 py-3 text-ink", more && "code-more")}>
      <div role="img" aria-label="Mermaid diagram" className="mx-auto w-max [&_svg]:max-w-none" dangerouslySetInnerHTML={{ __html: drawn.svg }} />
      <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button type="button" aria-label="Show code" className="inline-flex size-7 items-center justify-center rounded-row text-ink-3 hover:bg-wash-2 hover:text-ink" onClick={() => setShowCode(true)}>
          <Icon icon={CodeSquareIcon} size={14} />
        </button>
        <button
          type="button"
          aria-label={copied ? "Copied" : "Copy Mermaid source"}
          className="inline-flex size-7 items-center justify-center rounded-row text-ink-3 hover:bg-wash-2 hover:text-ink"
          onClick={() => {
            if (!navigator.clipboard) return
            void navigator.clipboard
              .writeText(source)
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
    </figure>
  )
}
