import {
  ArrowUp02Icon,
  ArrowUpRight01Icon,
  Cancel01Icon,
  Copy01Icon,
  Download04Icon,
  Hold01Icon,
  PencilEdit01Icon,
  Redo02Icon,
  SquareIcon,
  TextIcon,
  Tick02Icon,
  Undo02Icon,
  ViewOffSlashIcon,
  ZoomInAreaIcon,
} from "@hugeicons/core-free-icons"
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"

import { MAX_IMAGE_BYTES } from "@kiwi/core/protocol.ts"
import { arrowHead, base64Bytes, fitSide, INKS, markedName, meaningful, penPath, rect, strokeWidth, textSize, toImage, TOOL_KEYS, type Ink, type Mark, type Point, type Tool } from "@/lib/annotate"
import { cx } from "@/lib/utils"
import { Icon } from "./icon"
import { errorText, Monogram, toast } from "./kit"

export type Picture = { src: string; name: string; mime: string }

export type MarkedImage = { name: string; mime: string; data: string }

type Props = {
  picture: Picture
  sender: string
  agent: boolean
  when: string
  replyTo?: string
  onSend?: (note: string, image: MarkedImage) => Promise<void>
  onClose: () => void
}

const TOOLS: { tool: Tool; label: string; key: string; icon: typeof Hold01Icon }[] = [
  { tool: "move", label: "Move", key: "V", icon: Hold01Icon },
  { tool: "pen", label: "Pen", key: "P", icon: PencilEdit01Icon },
  { tool: "arrow", label: "Arrow", key: "A", icon: ArrowUpRight01Icon },
  { tool: "box", label: "Box", key: "B", icon: SquareIcon },
  { tool: "text", label: "Text", key: "T", icon: TextIcon },
  { tool: "hide", label: "Hide (blacks it out)", key: "H", icon: ViewOffSlashIcon },
]

const INK_NAMES: Record<Ink, string> = { alert: "Red", decide: "Amber", accent: "Blue", ink: "White" }
const INK_BG: Record<Ink, string> = { alert: "bg-alert", decide: "bg-decide", accent: "bg-accent", ink: "bg-ink" }
const MAX_SIDE = 2400
const PAD = 24

type Draft = { kind: "pen"; points: Point[] } | { kind: "arrow" | "box" | "hide"; from: Point; to: Point }

function halo(ink: Ink): string {
  return ink === "ink" ? "black" : "white"
}

function shape(m: Mark, sw: number, fs: number, key: number | string): ReactNode {
  switch (m.kind) {
    case "pen":
      return <path key={key} d={penPath(m.points)} fill="none" stroke={`var(--${m.ink})`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
    case "arrow": {
      const [a, b] = arrowHead(m.from, m.to, sw * 5)
      return (
        <g key={key} fill="none" stroke={`var(--${m.ink})`} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
          <line x1={m.from.x} y1={m.from.y} x2={m.to.x} y2={m.to.y} />
          <polyline points={`${a.x},${a.y} ${m.to.x},${m.to.y} ${b.x},${b.y}`} />
        </g>
      )
    }
    case "box": {
      const r = rect(m.from, m.to)
      return <rect key={key} x={r.x} y={r.y} width={r.w} height={r.h} rx={sw * 2} fill="none" stroke={`var(--${m.ink})`} strokeWidth={sw} />
    }
    case "hide": {
      const r = rect(m.from, m.to)
      return <rect key={key} x={r.x} y={r.y} width={r.w} height={r.h} rx={sw} fill="var(--canvas)" />
    }
    case "text":
      return (
        <text
          key={key}
          x={m.at.x}
          y={m.at.y}
          dominantBaseline="hanging"
          fontSize={fs}
          fontWeight={600}
          fontFamily="var(--font-sans)"
          fill={`var(--${m.ink})`}
          stroke={halo(m.ink)}
          strokeWidth={fs / 5}
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          {m.text}
        </text>
      )
  }
}

function draftMark(d: Draft, ink: Ink): Mark {
  return d.kind === "pen" ? { kind: "pen", ink, points: d.points } : d.kind === "hide" ? { kind: "hide", from: d.from, to: d.to } : { kind: d.kind, ink, from: d.from, to: d.to }
}

function resolver(root: HTMLElement): (token: string) => string {
  const probe = document.createElement("span")
  probe.style.display = "none"
  root.append(probe)
  return (token) => {
    probe.style.color = `var(--${token})`
    return getComputedStyle(probe).color
  }
}

function paint(ctx: CanvasRenderingContext2D, marks: Mark[], sw: number, fs: number, color: (token: string) => string, font: string) {
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  for (const m of marks) {
    ctx.lineWidth = sw
    if (m.kind === "hide") {
      const r = rect(m.from, m.to)
      ctx.fillStyle = color("canvas")
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, sw)
      ctx.fill()
      continue
    }
    ctx.strokeStyle = color(m.ink)
    ctx.fillStyle = color(m.ink)
    if (m.kind === "pen") {
      ctx.beginPath()
      m.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.stroke()
    } else if (m.kind === "arrow") {
      const [a, b] = arrowHead(m.from, m.to, sw * 5)
      ctx.beginPath()
      ctx.moveTo(m.from.x, m.from.y)
      ctx.lineTo(m.to.x, m.to.y)
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(m.to.x, m.to.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    } else if (m.kind === "box") {
      const r = rect(m.from, m.to)
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, sw * 2)
      ctx.stroke()
    } else {
      ctx.font = `600 ${fs}px ${font}`
      ctx.textBaseline = "top"
      ctx.lineWidth = fs / 5
      ctx.strokeStyle = halo(m.ink)
      ctx.strokeText(m.text, m.at.x, m.at.y)
      ctx.fillText(m.text, m.at.x, m.at.y)
    }
  }
}

async function burn(img: HTMLImageElement, marks: Mark[], picture: Picture, root: HTMLElement): Promise<MarkedImage> {
  const color = resolver(root)
  const font = getComputedStyle(root).fontFamily
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const sw = strokeWidth(nw, nh)
  const fs = textSize(nw, nh)
  const base = fitSide(nw, nh, MAX_SIDE)
  const png = picture.mime === "image/png" || picture.mime === "image/gif"
  for (const shrink of [1, 0.8, 0.64, 0.5, 0.4, 0.3]) {
    const width = Math.max(1, Math.round(base.width * shrink))
    const height = Math.max(1, Math.round(base.height * shrink))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("this browser can't draw the image")
    ctx.drawImage(img, 0, 0, width, height)
    ctx.scale(width / nw, height / nh)
    paint(ctx, marks, sw, fs, color, font)
    const tries = png && shrink === 1 ? (["image/png", 0.9, 0.8] as const) : ([0.9, 0.8, 0.7] as const)
    for (const t of tries) {
      const mime = typeof t === "string" ? t : "image/jpeg"
      const url = typeof t === "string" ? canvas.toDataURL(t) : canvas.toDataURL("image/jpeg", t)
      const data = url.slice(url.indexOf(",") + 1)
      if (base64Bytes(data) <= MAX_IMAGE_BYTES) return { name: markedName(picture.name, mime), mime, data }
    }
  }
  throw new Error("the marked image is too big to send")
}

function useStageSize(el: HTMLElement | null): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [el])
  return size
}

function ToolButton({ label, pressed, onClick, children, disabled }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-ctl transition-colors disabled:opacity-40",
        pressed ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-wash-2 hover:text-ink"
      )}
    >
      {children}
    </button>
  )
}

export function Annotator({ picture, sender, agent, when, replyTo, onSend, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const room = useStageSize(stage)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [tool, setTool] = useState<Tool>("arrow")
  const [ink, setInk] = useState<Ink>("alert")
  const [marks, setMarks] = useState<Mark[]>([])
  const [undone, setUndone] = useState<Mark[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [typing, setTyping] = useState<{ at: Point; text: string } | null>(null)
  const [full, setFull] = useState(false)
  const [note, setNote] = useState("")
  const [sending, setSending] = useState(false)
  const [asking, setAsking] = useState(false)
  const [copied, setCopied] = useState(false)
  const pan = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => closeButton.current?.focus(), [])

  const fit = natural && room.width ? Math.min(1, (room.width - PAD * 2) / natural.width, (room.height - PAD * 2) / natural.height) : 1
  const scale = full ? 1 : Math.max(0.05, fit)
  const shown = natural ? { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) } : null
  const sw = natural ? strokeWidth(natural.width, natural.height) : 2
  const fs = natural ? textSize(natural.width, natural.height) : 14

  const add = useCallback((m: Mark) => {
    setMarks((prev) => [...prev, m])
    setUndone([])
  }, [])
  const undo = useCallback(() => {
    setMarks((prev) => {
      const last = prev.at(-1)
      if (last) setUndone((u) => [...u, last])
      return prev.slice(0, -1)
    })
  }, [])
  const redo = useCallback(() => {
    setUndone((u) => {
      const last = u.at(-1)
      if (last) setMarks((prev) => [...prev, last])
      return u.slice(0, -1)
    })
  }, [])
  const commitText = useCallback(() => {
    setTyping((t) => {
      if (t && t.text.trim()) add({ kind: "text", ink, at: t.at, text: t.text.trim() })
      return null
    })
  }, [add, ink])
  const leave = useCallback(() => {
    if (marks.length && !sending) setAsking(true)
    else onClose()
  }, [marks.length, sending, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const field = e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
      if (e.key === "Escape") {
        e.preventDefault()
        if (typing) setTyping(null)
        else if (asking) setAsking(false)
        else leave()
        return
      }
      if (field) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const next = TOOL_KEYS[e.key.toLowerCase()]
      if (next) setTool(next)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [typing, asking, leave, undo, redo])

  const pointAt = (e: ReactPointerEvent<SVGSVGElement>): Point | null => {
    if (!natural) return null
    return toImage(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), natural)
  }

  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    if (tool === "move") {
      pan.current = { x: e.clientX, y: e.clientY }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    const p = pointAt(e)
    if (!p) return
    if (tool === "text") {
      e.preventDefault()
      commitText()
      setTyping({ at: p, text: "" })
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDraft(tool === "pen" ? { kind: "pen", points: [p] } : { kind: tool, from: p, to: p })
  }
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const el = scroller.current
    if (pan.current && el) {
      el.scrollBy(pan.current.x - e.clientX, pan.current.y - e.clientY)
      pan.current = { x: e.clientX, y: e.clientY }
      return
    }
    if (!draft) return
    const p = pointAt(e)
    if (!p) return
    setDraft(draft.kind === "pen" ? { kind: "pen", points: [...draft.points, p] } : { ...draft, to: p })
  }
  const up = () => {
    pan.current = null
    if (!draft) return
    const m = draftMark(draft, ink)
    if (meaningful(m, sw * 2)) add(m)
    setDraft(null)
  }

  const exportNow = async () => {
    if (!img.current || !root.current) throw new Error("the image hasn't loaded")
    return burn(img.current, marks, picture, root.current)
  }
  const download = async () => {
    try {
      const out = marks.length ? await exportNow() : { name: picture.name, mime: picture.mime, data: picture.src.slice(picture.src.indexOf(",") + 1) }
      const a = document.createElement("a")
      a.href = `data:${out.mime};base64,${out.data}`
      a.download = out.name
      a.click()
    } catch (err) {
      toast(`Not saved: ${errorText(err)}`, "error")
    }
  }
  const copy = async () => {
    try {
      const out = marks.length ? await exportNow() : { name: picture.name, mime: picture.mime, data: picture.src.slice(picture.src.indexOf(",") + 1) }
      const blob = await (await fetch(`data:${out.mime};base64,${out.data}`)).blob()
      const png = out.mime === "image/png" ? blob : await toPng(blob)
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      toast(`Not copied: ${errorText(err)}`, "error")
    }
  }
  const send = async () => {
    if (!onSend || !marks.length || sending) return
    setSending(true)
    try {
      await onSend(note.trim(), await exportNow())
      toast(`Sent to ${replyTo ?? sender}`)
      onClose()
    } catch (err) {
      toast(`Not sent: ${errorText(err)}`, "error")
      setSending(false)
    }
  }

  const live = draft ? draftMark(draft, ink) : null
  const cursor = tool === "move" ? (full ? "grab" : "default") : tool === "text" ? "text" : "crosshair"

  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label={`Mark up ${picture.name}`} className="animate-rise dark-stage fixed inset-0 z-50 flex flex-col bg-canvas text-ink">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 md:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Monogram name={sender} agent={agent} size={28} />
          <div className="min-w-0">
            <p className="truncate text-ui font-semibold">{sender}</p>
            <p className="truncate text-meta text-ink-3">
              <span className="max-md:hidden">{picture.name} · </span>
              {when}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setFull((f) => !f)}
            className="inline-flex h-8 items-center gap-1.5 rounded-ctl px-2.5 text-meta text-ink-2 tabular-nums hover:bg-wash-2 hover:text-ink max-md:hidden"
            aria-label={full ? "Fit to window" : "Actual size"}
          >
            <Icon icon={ZoomInAreaIcon} size={16} />
            {full ? "100%" : `Fit · ${Math.round(scale * 100)}%`}
          </button>
          <span className="max-md:hidden">
            <ToolButton label={copied ? "Copied" : "Copy image"} onClick={() => void copy()}>
              <Icon icon={copied ? Tick02Icon : Copy01Icon} size={18} />
            </ToolButton>
          </span>
          <ToolButton label="Download" onClick={() => void download()}>
            <Icon icon={Download04Icon} size={18} />
          </ToolButton>
          <button ref={closeButton} type="button" aria-label="Close" onClick={leave} className="ml-1 inline-flex size-8 items-center justify-center rounded-full bg-wash-2 text-ink hover:bg-wash">
            <Icon icon={Cancel01Icon} size={18} />
          </button>
        </div>
      </header>

      <div
        ref={(el) => {
          scroller.current = el
          setStage(el)
        }}
        className={cx("relative min-h-0 flex-1", full ? "overflow-auto" : "overflow-hidden")}
      >
        <div
          className="flex min-h-full min-w-full items-center justify-center"
          style={{ padding: PAD, width: full && shown ? shown.width + PAD * 2 : undefined, height: full && shown ? shown.height + PAD * 2 : undefined }}
        >
          <div className="relative shrink-0 overflow-hidden rounded-card shadow-[0_0_0_1px_var(--line)]" style={shown ? { width: shown.width, height: shown.height } : undefined}>
            <img
              ref={img}
              src={picture.src}
              alt={picture.name}
              draggable={false}
              onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
              className="block size-full select-none"
            />
            {natural && (
              <svg
                viewBox={`0 0 ${natural.width} ${natural.height}`}
                className="absolute inset-0 size-full touch-none"
                style={{ cursor }}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                aria-hidden
              >
                {marks.map((m, i) => shape(m, sw, fs, i))}
                {live && shape(live, sw, fs, "live")}
              </svg>
            )}
            {typing && natural && (
              <input
                autoFocus
                aria-label="Text on the image"
                value={typing.text}
                onChange={(e) => setTyping({ ...typing, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    commitText()
                  }
                }}
                onBlur={commitText}
                className="absolute min-w-24 rounded-row bg-raised/90 px-1.5 py-0.5 text-body font-semibold outline-none"
                style={{ left: `${(typing.at.x / natural.width) * 100}%`, top: `${(typing.at.y / natural.height) * 100}%`, color: `var(--${ink})` }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 justify-center px-3 pt-2 pb-3">
        <div role="toolbar" aria-label="Markup tools" className="flex max-w-full items-center gap-1 overflow-x-auto rounded-card bg-raised p-1.5 shadow-pop">
          {TOOLS.map((t) => (
            <ToolButton key={t.tool} label={`${t.label} (${t.key})`} pressed={tool === t.tool} onClick={() => setTool(t.tool)}>
              <Icon icon={t.icon} size={18} />
            </ToolButton>
          ))}
          <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
          <div role="radiogroup" aria-label="Color" className="flex shrink-0 items-center gap-2.5 px-1.5">
            {INKS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={ink === k}
                aria-label={INK_NAMES[k]}
                onClick={() => setInk(k)}
                className={cx("size-5 shrink-0 rounded-full", INK_BG[k], ink === k ? "ring-2 ring-ink ring-offset-2 ring-offset-raised" : "shadow-[inset_0_0_0_1px_var(--line)]")}
              />
            ))}
          </div>
          <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />
          <ToolButton label="Undo" onClick={undo} disabled={!marks.length}>
            <Icon icon={Undo02Icon} size={18} />
          </ToolButton>
          <ToolButton label="Redo" onClick={redo} disabled={!undone.length}>
            <Icon icon={Redo02Icon} size={18} />
          </ToolButton>
        </div>
      </div>

      {onSend && replyTo && (
        <form
          className="flex shrink-0 justify-center px-3 pb-4 md:pb-6"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <div className="flex w-full max-w-[640px] items-center gap-2.5 rounded-bubble bg-raised p-2 shadow-pop">
            <span className="relative size-9 shrink-0 overflow-hidden rounded-ctl shadow-[0_0_0_1px_var(--line)]">
              <img src={picture.src} alt="" className="size-full object-cover" />
              {marks.length > 0 && (
                <span className="absolute right-0.5 bottom-0.5 min-w-3.5 rounded-full bg-alert-fill px-1 text-center text-stamp leading-3.5 font-semibold text-white tabular-nums">{marks.length}</span>
              )}
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={marks.length ? `Reply to ${replyTo} with your marks…` : "Mark something up to reply with it"}
              aria-label="Note with your marks"
              className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
            />
            <span className="shrink-0 text-meta text-ink-3 max-md:hidden">in the thread</span>
            <button
              type="submit"
              aria-label="Send with marks"
              disabled={!marks.length || sending}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity disabled:opacity-40"
            >
              <Icon icon={ArrowUp02Icon} size={18} />
            </button>
          </div>
        </form>
      )}

      {asking && (
        <div
          role="alertdialog"
          aria-label="Discard your marks?"
          className="animate-rise absolute inset-x-0 top-16 mx-auto flex w-fit items-center gap-3 rounded-card bg-raised px-4 py-2.5 text-ui shadow-pop"
        >
          <span>Discard {marks.length === 1 ? "your mark" : `your ${marks.length} marks`}?</span>
          <button type="button" onClick={() => setAsking(false)} className="rounded-row px-2.5 py-1 font-medium text-ink-2 hover:bg-wash-2">
            Keep editing
          </button>
          <button type="button" autoFocus onClick={onClose} className="rounded-row bg-alert-fill px-2.5 py-1 font-medium text-white">
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0)
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("couldn't make a PNG"))), "image/png"))
}
