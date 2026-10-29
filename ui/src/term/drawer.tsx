import "~/styles/term.css"

import { FitAddon, Ghostty, Terminal, type ITheme } from "ghostty-web"
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url"
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

import { Avatar, IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { memberOf, type Channel, type TermLink, type TermWatch } from "~/model"
import { shown } from "~/names"
import { useApp, type TermOf } from "~/nav"

const SCROLLBACK = 3_000
const RESIZE_MS = 120
const HEIGHT_KEY = "kiwi.term.height"
const MIN_HEIGHT = 180
const ADVANCE = 0.6025
const CELL = 8
const FONT = '"SF Mono", SFMono-Regular, Menlo, "DejaVu Sans Mono", ui-monospace, monospace'

type Phase = { kind: "opening" } | { kind: "live"; cols: number; rows: number } | { kind: "ended"; cols: number; rows: number } | { kind: "error"; why: string }

let ghostty: Promise<Ghostty> | null = null

function loadGhostty(): Promise<Ghostty> {
  ghostty ??= fetch(wasmUrl)
    .then((r) => r.arrayBuffer())
    .then((bytes) => WebAssembly.instantiate(bytes, { env: { log: () => {} } }))
    .then(({ instance }) => new Ghostty(instance))
    .catch((err: unknown) => {
      ghostty = null
      throw err
    })
  return ghostty
}

function themeOf(css: CSSStyleDeclaration): ITheme {
  const v = (name: string) => css.getPropertyValue(name).trim()
  return {
    background: v("--bg"),
    foreground: v("--ink"),
    cursor: v("--ink"),
    cursorAccent: v("--bg"),
    selectionBackground: v("--bg-3"),
    selectionForeground: v("--ink"),
    black: v("--bg-3"),
    red: v("--c-red"),
    green: v("--c-green"),
    yellow: v("--c-yellow"),
    blue: v("--c-blue"),
    magenta: v("--c-violet"),
    cyan: v("--c-teal"),
    white: v("--ink-2"),
    brightBlack: v("--ink-3"),
    brightRed: v("--c-red"),
    brightGreen: v("--c-green"),
    brightYellow: v("--c-yellow"),
    brightBlue: v("--c-indigo"),
    brightMagenta: v("--c-pink"),
    brightCyan: v("--c-teal"),
    brightWhite: v("--ink"),
  }
}

function storedHeight(): number | null {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY))
    return n >= MIN_HEIGHT ? n : null
  } catch {
    // No storage here (a private window): the drawer starts at its default height.
    return null
  }
}

function keepHeight(h: number): void {
  try {
    localStorage.setItem(HEIGHT_KEY, String(Math.round(h)))
  } catch {
    // Same as reading: the height just isn't remembered.
  }
}

export default function TermDrawer({ channel, of }: { channel: Channel; of: TermOf }) {
  const { app, go } = useApp()
  const name = of.kind === "agent" ? of.name : null
  const person = name ? memberOf(channel, name) : undefined
  const title = name === null ? "Your terminal" : person ? shown(person) : name
  const host = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>({ kind: "opening" })
  const [height, setHeight] = useState<number | null>(storedHeight)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let gone = false
    let link: TermLink | null = null
    let term: Terminal | null = null
    let observer: ResizeObserver | null = null
    let timer = 0
    void (async () => {
      try {
        const g = await loadGhostty()
        const css = getComputedStyle(document.documentElement)
        const scale = Number(css.getPropertyValue("--text-scale")) || 1
        if (gone) return
        const t = new Terminal({ ghostty: g, fontSize: (Math.round(CELL * scale) - 0.02) / ADVANCE, fontFamily: FONT, theme: themeOf(css), scrollback: SCROLLBACK, cursorBlink: false })
        term = t
        const fit = new FitAddon()
        t.loadAddon(fit)
        t.open(el)
        const want = fit.proposeDimensions() ?? { cols: 100, rows: 30 }
        const watch: TermWatch = {
          out: (text) => t.write(text),
          ended: () => setPhase((p) => (p.kind === "live" ? { ...p, kind: "ended" } : p)),
        }
        const opened = name === null ? await app.actions.openMyTerm(channel.code, want.cols, want.rows, watch) : await app.actions.openTerm(channel.code, name, want.cols, want.rows, watch)
        if (gone) {
          if ("link" in opened) opened.link.close()
          return
        }
        if ("error" in opened) {
          setPhase({ kind: "error", why: opened.error })
          return
        }
        const l = opened.link
        link = l
        t.resize(opened.screen.cols, opened.screen.rows)
        t.write(opened.screen.seed)
        setPhase({ kind: opened.screen.dead ? "ended" : "live", cols: opened.screen.cols, rows: opened.screen.rows })
        t.onData((data) => l.keys(data))
        t.focus()
        observer = new ResizeObserver(() => {
          window.clearTimeout(timer)
          timer = window.setTimeout(() => {
            const next = fit.proposeDimensions()
            if (!next || (next.cols === t.cols && next.rows === t.rows)) return
            t.resize(next.cols, next.rows)
            l.size(next.cols, next.rows)
            setPhase((p) => (p.kind === "live" || p.kind === "ended" ? { ...p, cols: next.cols, rows: next.rows } : p))
          }, RESIZE_MS)
        })
        observer.observe(el)
      } catch (err) {
        if (!gone) setPhase({ kind: "error", why: err instanceof Error ? err.message : String(err) })
      }
    })()
    return () => {
      gone = true
      window.clearTimeout(timer)
      observer?.disconnect()
      link?.close()
      term?.dispose()
    }
  }, [app.actions, channel.code, name])

  const grip = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sheet = e.currentTarget.parentElement
    const room = sheet?.parentElement
    if (!sheet || !room) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const startY = e.clientY
    const startH = sheet.getBoundingClientRect().height
    const max = room.getBoundingClientRect().height - 48
    let last = startH
    const move = (ev: PointerEvent) => {
      last = Math.min(max, Math.max(MIN_HEIGHT, startH + startY - ev.clientY))
      setHeight(last)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      keepHeight(last)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  const size = phase.kind === "live" || phase.kind === "ended" ? `${phase.cols}×${phase.rows}` : null
  return (
    <section className="term" aria-label={name === null ? title : `${title}'s terminal`} style={height ? { height } : undefined} onKeyDown={(e) => e.stopPropagation()}>
      <div className="term-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the terminal" onPointerDown={grip} onDoubleClick={() => setHeight(null)} />
      <header className="term-head">
        {name === null ? (
          <span className="term-mine" aria-hidden="true">
            <Icon name="terminal" size={14} />
          </span>
        ) : (
          <Avatar person={person} size="sm" />
        )}
        <span className="term-name">{title}</span>
        <span className="term-where">
          {name === null ? "this computer" : "Channels' tmux"}
          {size && <span className="term-size"> · {size}</span>}
          {phase.kind === "ended" && <span className="term-ended"> · exited</span>}
        </span>
        <IconButton
          icon="close"
          label={name === null ? "Close the terminal (your shell keeps running)" : "Close the terminal (the agent keeps running)"}
          onClick={() => go({ to: "term", term: null })}
        />
      </header>
      <div className="term-screen" ref={host} />
      {phase.kind === "opening" && <p className="term-note">Opening…</p>}
      {phase.kind === "error" && (
        <p className="term-note is-error" role="alert">
          {phase.why}
        </p>
      )}
    </section>
  )
}
