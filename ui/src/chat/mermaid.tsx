import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { sanitizeMarkdownUrl } from "@kiwi/app/markdown.ts"

type Mermaid = (typeof import("mermaid"))["default"]
export type Drawn = { kind: "svg"; svg: string } | { kind: "error"; message: string } | null

let mermaid: Promise<Mermaid> | undefined
const load = () => (mermaid ??= import("mermaid").then((m) => m.default))

const CSS = [
  "* { filter: none !important; }",
  ".node rect, .node polygon, .node path, rect.actor, rect.note, .labelBox { stroke-width: 1px; }",
  ".node rect, rect.actor, rect.note { rx: 8px; ry: 8px; }",
  ".flowchart-link, .messageLine0, .messageLine1, .actor-line { stroke-width: 1px; }",
].join("\n")

let queue: Promise<unknown> = Promise.resolve()
let next = 0

const MIN_SCALE = 0.7

function resolver(): { color: (token: string) => string; font: string; done: () => void } {
  const probe = document.createElement("span")
  probe.style.display = "none"
  probe.style.fontFamily = "var(--sans)"
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
    font: getComputedStyle(probe).fontFamily || "system-ui, sans-serif",
    done: () => probe.remove(),
  }
}

function theme(): { variables: Record<string, string>; font: string } {
  const { color: c, font, done } = resolver()
  const variables = {
    background: c("raise"),
    mainBkg: c("bg"),
    primaryColor: c("bg"),
    primaryTextColor: c("ink"),
    primaryBorderColor: c("ink-3"),
    secondaryColor: c("accent-wash"),
    secondaryTextColor: c("ink"),
    secondaryBorderColor: c("accent"),
    tertiaryColor: c("raise"),
    tertiaryTextColor: c("ink"),
    tertiaryBorderColor: c("line-3"),
    nodeBorder: c("ink-3"),
    nodeTextColor: c("ink"),
    textColor: c("ink-2"),
    lineColor: c("ink-3"),
    edgeLabelBackground: c("raise"),
    clusterBkg: c("raise-2"),
    clusterBorder: c("line-3"),
    titleColor: c("ink"),
    actorBkg: c("bg"),
    actorBorder: c("ink-3"),
    actorTextColor: c("ink"),
    actorLineColor: c("ink-3"),
    signalColor: c("ink-2"),
    signalTextColor: c("ink"),
    labelBoxBkgColor: c("bg"),
    labelBoxBorderColor: c("ink-3"),
    labelTextColor: c("ink"),
    loopTextColor: c("ink-2"),
    noteBkgColor: c("accent-wash"),
    noteBorderColor: c("accent"),
    noteTextColor: c("ink"),
    activationBkgColor: c("bg"),
    activationBorderColor: c("ink-3"),
    sequenceNumberColor: c("on-ink"),
    fontFamily: font,
    fontSize: "13px",
  }
  done()
  return { variables, font }
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

const ADDRESS = /\s(?:xlink:href|href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
const OPENED = /^(?:https?:\/\/|mailto:)/i

const unescaped = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim()

const keeping = (attrs: string, kept: (address: string) => boolean): string =>
  attrs.replace(ADDRESS, (all: string, double?: string, single?: string, bare?: string) => (kept(unescaped(double ?? single ?? bare ?? "")) ? all : ""))

export function linksApart(svg: string): string {
  return svg.replace(/<a\b([^>]*?)(\/?)>/g, (_, attrs: string, close: string) => {
    const opened = keeping(attrs.replace(/\s(?:target|rel)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, ""), (url) => OPENED.test(url) && !!sanitizeMarkdownUrl(url))
    return `<a${opened} target="_blank" rel="noopener noreferrer"${close}>`
  })
}

export function picturesOff(svg: string): string {
  return svg.replace(/<(image|img)\b([^>]*?)(\/?)>/gi, (_, tag: string, attrs: string, close: string) => `<${tag}${keeping(attrs, (url) => /^data:/i.test(url))}${close}>`)
}

function draw(source: string): Promise<Drawn> {
  const run = queue.then(async (): Promise<Drawn> => {
    const m = await load()
    const { variables, font } = theme()
    m.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      themeVariables: variables,
      fontFamily: font,
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
        actorFontFamily: font,
        actorFontSize: 13,
        messageFontFamily: font,
        messageFontSize: 13,
        messageFontWeight: 400,
        noteFontFamily: font,
        noteFontSize: 13,
      },
    })
    try {
      await m.parse(source)
      const { svg } = await m.render(`kiwi-mermaid-${next++}`, source)
      return { kind: "svg", svg: picturesOff(linksApart(svg)) }
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
  const oldest = drawings.keys().next()
  if (drawings.size > MAX_DRAWN && !oldest.done) drawings.delete(oldest.value)
  return fresh
}

function useScheme(): string {
  const read = () => {
    const root = document.documentElement
    return `${root.dataset.theme ?? ""}:${root.dataset.font ?? ""}:${matchMedia("(prefers-color-scheme: dark)").matches}:${root.style.cssText}`
  }
  const [scheme, setScheme] = useState("")
  useEffect(() => {
    const update = () => setScheme(read())
    update()
    const media = matchMedia("(prefers-color-scheme: dark)")
    media.addEventListener("change", update)
    const watch = new MutationObserver(update)
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-font", "style"] })
    return () => {
      media.removeEventListener("change", update)
      watch.disconnect()
    }
  }, [])
  return scheme
}

const linkOf = (a: Element): string | null => a.getAttribute("href") ?? a.getAttribute("xlink:href")

export function MermaidBlock({ source, code, onLink, copied }: { source: string; code: ReactNode; onLink: (url: string) => void; copied: () => void }) {
  const scheme = useScheme()
  const [drawn, setDrawn] = useState<Drawn>(null)
  const [showCode, setShowCode] = useState(false)
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

  const clicked = (e: MouseEvent<HTMLElement>) => {
    const a = e.target instanceof Element ? e.target.closest("a") : null
    if (!a) return
    e.preventDefault()
    const url = linkOf(a)
    if (url) onLink(url)
  }

  if (drawn?.kind === "error") {
    return (
      <div className="md-mermaid">
        {code}
        <p className="md-mermaid-error">Couldn’t draw this Mermaid diagram: {drawn.message}</p>
      </div>
    )
  }
  if (!drawn || showCode) {
    return (
      <div ref={near} className="md-mermaid">
        {code}
        {drawn && (
          <div className="md-mermaid-tools is-code">
            <button type="button" onClick={() => setShowCode(false)}>
              Diagram
            </button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="md-mermaid">
      <figure ref={box} onScroll={measure} onClick={clicked} className={more ? "md-mermaid-drawn code-more" : "md-mermaid-drawn"}>
        <div role="img" aria-label="Mermaid diagram" dangerouslySetInnerHTML={{ __html: drawn.svg }} />
      </figure>
      <div className="md-mermaid-tools">
        <button type="button" onClick={() => setShowCode(true)}>
          Code
        </button>
        <button type="button" aria-label="Copy Mermaid source" onClick={() => void navigator.clipboard?.writeText(source).then(copied, () => {})}>
          Copy
        </button>
      </div>
    </div>
  )
}
