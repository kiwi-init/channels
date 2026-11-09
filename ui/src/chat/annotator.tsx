import "~/i18n/en/chat-later"
import "~/styles/annotator.css"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"

import { MAX_IMAGE_SIDE } from "@kiwi/core/fit-image.ts"
import { MAX_IMAGE_BYTES } from "@kiwi/core/protocol.ts"
import {
  arrowHead,
  base64Blob,
  fitSide,
  INKS,
  markedName,
  meaningful,
  penPath,
  rect,
  strokeWidth,
  textSize,
  toImage,
  TOOL_KEYS,
  type Ink,
  type Mark,
  type Point,
  type Tool,
} from "@kiwi/app/annotate.ts"
import { compressImage, readBase64 } from "@kiwi/app/compress-image.ts"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { Avatar, cx } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { clock } from "~/kit/time"
import type { Person, Upload } from "~/model"
import { useAct } from "~/nav"

type Face = Pick<Person, "name" | "kind" | "harness" | "presence" | "color">

const TOOL_PATHS: Record<Tool, string> = {
  move: "M8 2v12M2 8h12M6.5 3.5 8 2l1.5 1.5M6.5 12.5 8 14l1.5-1.5M3.5 6.5 2 8l1.5 1.5M12.5 6.5 14 8l-1.5 1.5",
  pen: "M10.5 2.8 13.2 5.5 6 12.7l-3.2.5.5-3.2z",
  arrow: "M3.5 12.5 12.5 3.5M7 3.5h5.5V9",
  box: "M3 4h10v8H3z",
  text: "M3.5 4h9M8 4v9",
  hide: "M3 4h10v8H3zM3 12l10-8",
}
const UNDO = "M5.5 4 3 6.5 5.5 9M3 6.5h6.5a3.25 3.25 0 0 1 0 6.5H8"
const REDO = "M10.5 4 13 6.5 10.5 9M13 6.5H6.5a3.25 3.25 0 0 0 0 6.5H8"

const TOOLS: { tool: Tool; label: Key; key: string }[] = [
  { tool: "move", label: "chat.annotator.tool.move", key: "V" },
  { tool: "pen", label: "chat.annotator.tool.pen", key: "P" },
  { tool: "arrow", label: "chat.annotator.tool.arrow", key: "A" },
  { tool: "box", label: "chat.annotator.tool.box", key: "B" },
  { tool: "text", label: "chat.annotator.tool.text", key: "T" },
  { tool: "hide", label: "chat.annotator.tool.hide", key: "H" },
]

const INK_NAMES: Record<Ink, Key> = { alert: "chat.annotator.ink.red", decide: "chat.annotator.ink.amber", accent: "chat.annotator.ink.blue", ink: "chat.annotator.ink.ink" }
const HIDE = "#000"
const PAD = 24

type Draft = { kind: "pen"; points: Point[] } | { kind: "arrow" | "box" | "hide"; from: Point; to: Point }

function Glyph({ d }: { d: string }) {
  return (
    <svg className="icon" width={18} height={18} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const halo = (ink: Ink): string => (ink === "ink" ? "var(--bg)" : "rgb(0 0 0 / 0.6)")

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
      return <rect key={key} x={r.x} y={r.y} width={r.w} height={r.h} rx={sw} fill={HIDE} />
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
          fontFamily="var(--ui)"
          fill={`var(--${m.ink})`}
          stroke={halo(m.ink)}
          strokeWidth={fs / 7}
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

function resolver(root: HTMLElement): (value: string) => string {
  const probe = document.createElement("span")
  probe.style.display = "none"
  root.append(probe)
  return (value) => {
    probe.style.color = value
    return getComputedStyle(probe).color
  }
}

function paint(ctx: CanvasRenderingContext2D, marks: Mark[], sw: number, fs: number, color: (value: string) => string, font: string) {
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  for (const m of marks) {
    ctx.lineWidth = sw
    if (m.kind === "hide") {
      const r = rect(m.from, m.to)
      ctx.fillStyle = HIDE
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, sw)
      ctx.fill()
      continue
    }
    ctx.strokeStyle = color(`var(--${m.ink})`)
    ctx.fillStyle = color(`var(--${m.ink})`)
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
      ctx.lineWidth = fs / 7
      ctx.strokeStyle = color(halo(m.ink))
      ctx.strokeText(m.text, m.at.x, m.at.y)
      ctx.fillText(m.text, m.at.x, m.at.y)
    }
  }
}

const mimeOf = (url: string): string => /^data:([^;,]+)/.exec(url)?.[1] ?? "image/png"
const dataOf = (url: string): string => url.slice(url.indexOf(",") + 1)

async function burn(img: HTMLImageElement, marks: Mark[], name: string, mime: string, root: HTMLElement): Promise<Upload> {
  const color = resolver(root)
  const font = getComputedStyle(root).fontFamily
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const base = fitSide(nw, nh, MAX_IMAGE_SIDE)
  const canvas = document.createElement("canvas")
  canvas.width = base.width
  canvas.height = base.height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error(t("chat.annotator.cant.draw"))
  ctx.drawImage(img, 0, 0, base.width, base.height)
  ctx.scale(base.width / nw, base.height / nh)
  paint(ctx, marks, strokeWidth(nw, nh), textSize(nw, nh), color, font)
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"))
  if (!png) throw new Error(t("chat.annotator.cant.draw"))
  if ((mime === "image/png" || mime === "image/gif") && png.size <= MAX_IMAGE_BYTES) return { name: markedName(name, "image/png"), mime: "image/png", data: await readBase64(png) }
  const out = await compressImage(png, MAX_IMAGE_BYTES)
  if (!out) throw new Error(t("chat.annotator.cant.read"))
  return { name: markedName(name, out.mime), mime: out.mime, data: out.data }
}

async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0)
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error(t("chat.annotator.no.png")))), "image/png"))
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

const say = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export interface AnnotatorProps {
  image: { url: string; alt: string }
  sender: string
  face: Face | undefined
  at: number
  onSend?: (note: string, image: Upload) => void
  onClose: () => void
}

export default function Annotator({ image, sender, face, at, onSend, onClose }: AnnotatorProps) {
  const { toast } = useAct()
  const dialog = useRef<HTMLDialogElement>(null)
  const img = useRef<HTMLImageElement>(null)
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
  const [asking, setAsking] = useState(false)
  const [copied, setCopied] = useState(false)
  const pan = useRef<{ x: number; y: number } | null>(null)
  const name = image.alt || "image"
  const mime = mimeOf(image.url)

  useEffect(() => {
    const el = dialog.current
    if (el && !el.open) el.showModal()
  }, [])

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
    if (marks.length) setAsking(true)
    else onClose()
  }, [marks.length, onClose])

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

  const pointAt = (e: ReactPointerEvent<SVGSVGElement>): Point | null => (natural ? toImage(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect(), natural) : null)

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

  const current = async (): Promise<Upload> => {
    if (!marks.length) return { name, mime, data: dataOf(image.url) }
    if (!img.current || !dialog.current) throw new Error(t("chat.annotator.not.loaded"))
    return burn(img.current, marks, name, mime, dialog.current)
  }
  const download = async () => {
    try {
      const out = await current()
      const a = document.createElement("a")
      a.href = `data:${out.mime};base64,${out.data}`
      a.download = out.name
      a.click()
    } catch (err) {
      toast(t("chat.annotator.not.saved", { why: say(err) }), "error")
    }
  }
  const copy = () => {
    if (!navigator.clipboard) return toast(t("chat.annotator.no.clipboard"), "error")
    const png = current().then((out) => {
      const blob = base64Blob(out.data, out.mime)
      return out.mime === "image/png" ? blob : toPng(blob)
    })
    navigator.clipboard.write([new ClipboardItem({ "image/png": png })]).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      },
      (err: unknown) => toast(t("chat.annotator.not.copied", { why: say(err) }), "error")
    )
  }
  const send = async () => {
    if (!onSend || !marks.length) return
    try {
      onSend(note.trim(), await current())
      toast(t("chat.annotator.sent.to", { name: sender }))
      onClose()
    } catch (err) {
      toast(t("chat.annotator.not.sent", { why: say(err) }), "error")
    }
  }

  const live = draft ? draftMark(draft, ink) : null
  const cursor = tool === "move" ? (full ? "grab" : "default") : tool === "text" ? "text" : "crosshair"

  return (
    <dialog
      ref={dialog}
      className="annot"
      aria-label={t("chat.annotator.mark.up", { name })}
      onCancel={(e) => {
        e.preventDefault()
        if (!typing && !asking) leave()
      }}
      onClose={onClose}
    >
      <header className="annot-head">
        <div className="annot-who">
          <Avatar person={face} size="sm" />
          <div className="annot-who-text">
            <p className="annot-name">{sender}</p>
            <p className="annot-meta">
              {name} · {clock(at)}
            </p>
          </div>
        </div>
        <div className="annot-actions">
          <button type="button" className="btn is-quiet annot-zoom" onClick={() => setFull((f) => !f)} aria-label={full ? t("chat.annotator.fit.window") : t("chat.annotator.actual.size")}>
            {full ? "100%" : t("chat.annotator.fit.percent", { percent: Math.round(scale * 100) })}
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={copied ? t("chat.annotator.copied") : t("chat.annotator.copy.image")}
            title={copied ? t("chat.annotator.copied") : t("chat.annotator.copy.image")}
            onClick={copy}
          >
            <Icon name={copied ? "check" : "copy"} />
          </button>
          <button type="button" className="icon-btn" aria-label={t("chat.annotator.download")} title={t("chat.annotator.download")} onClick={() => void download()}>
            <Icon name="download" />
          </button>
          <button type="button" className="icon-btn annot-close" aria-label={t("chat.annotator.close")} title={t("chat.annotator.close")} autoFocus onClick={leave}>
            <Icon name="close" />
          </button>
        </div>
      </header>

      <div
        ref={(el) => {
          scroller.current = el
          setStage(el)
        }}
        className={cx("annot-stage", full && "is-full")}
      >
        <div className="annot-room" style={{ padding: PAD, width: full && shown ? shown.width + PAD * 2 : undefined, height: full && shown ? shown.height + PAD * 2 : undefined }}>
          <div className="annot-frame" style={shown ? { width: shown.width, height: shown.height } : undefined}>
            <img ref={img} src={image.url} alt={image.alt} draggable={false} onLoad={(e) => setNatural({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })} />
            {natural && (
              <svg
                viewBox={`0 0 ${natural.width} ${natural.height}`}
                className="annot-marks"
                style={{ cursor }}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={up}
                aria-hidden="true"
              >
                {marks.map((m, i) => shape(m, sw, fs, i))}
                {live && shape(live, sw, fs, "live")}
              </svg>
            )}
            {typing && natural && (
              <input
                autoFocus
                aria-label={t("chat.annotator.text.on.image")}
                className="annot-typing"
                value={typing.text}
                onChange={(e) => setTyping({ ...typing, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    commitText()
                  }
                }}
                onBlur={commitText}
                style={{ left: `${(typing.at.x / natural.width) * 100}%`, top: `${(typing.at.y / natural.height) * 100}%`, color: `var(--${ink})` }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="annot-bar">
        <div role="toolbar" aria-label={t("chat.annotator.tools")} className="annot-tools">
          {TOOLS.map((item) => (
            <button
              key={item.tool}
              type="button"
              className="annot-tool"
              aria-label={t("chat.annotator.tool.with.key", { tool: t(item.label), key: item.key })}
              title={t("chat.annotator.tool.with.key", { tool: t(item.label), key: item.key })}
              aria-pressed={tool === item.tool}
              onClick={() => setTool(item.tool)}
            >
              <Glyph d={TOOL_PATHS[item.tool]} />
            </button>
          ))}
          <span className="annot-sep" aria-hidden="true" />
          <div role="radiogroup" aria-label={t("chat.annotator.color")} className="annot-inks">
            {INKS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={ink === k}
                aria-label={t(INK_NAMES[k])}
                title={t(INK_NAMES[k])}
                className="annot-ink"
                style={{ background: `var(--${k})` }}
                onClick={() => setInk(k)}
              />
            ))}
          </div>
          <span className="annot-sep" aria-hidden="true" />
          <button type="button" className="annot-tool" aria-label={t("chat.annotator.undo")} title={t("chat.annotator.undo")} onClick={undo} disabled={!marks.length}>
            <Glyph d={UNDO} />
          </button>
          <button type="button" className="annot-tool" aria-label={t("chat.annotator.redo")} title={t("chat.annotator.redo")} onClick={redo} disabled={!undone.length}>
            <Glyph d={REDO} />
          </button>
        </div>
      </div>

      {onSend && (
        <form
          className="annot-reply"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <span className="annot-thumb">
            <img src={image.url} alt="" />
            {marks.length > 0 && <span className="annot-count">{marks.length}</span>}
          </span>
          <input
            className="annot-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={marks.length ? t("chat.annotator.reply.with.marks", { name: sender }) : t("chat.annotator.mark.to.reply")}
            aria-label={t("chat.annotator.note")}
          />
          <button type="submit" className="icon-btn annot-send" aria-label={t("chat.annotator.send")} disabled={!marks.length}>
            <Icon name="send" />
          </button>
        </form>
      )}

      {asking && (
        <div role="alertdialog" aria-label={t("chat.annotator.discard.ask")} className="annot-ask">
          <span>{marks.length === 1 ? t("chat.annotator.discard.one") : t("chat.annotator.discard.many", { count: marks.length })}</span>
          <button type="button" className="btn is-quiet" onClick={() => setAsking(false)}>
            {t("chat.annotator.keep.editing")}
          </button>
          <button type="button" className="btn is-danger" autoFocus onClick={onClose}>
            {t("chat.annotator.discard")}
          </button>
        </div>
      )}
    </dialog>
  )
}
