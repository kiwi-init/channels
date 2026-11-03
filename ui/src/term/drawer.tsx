import "~/styles/term.css"

import { FitAddon, Ghostty, Terminal, type ITheme } from "ghostty-web"
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url"
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

import { Avatar, cx, IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { openMenu } from "~/kit/menu-open"
import { memberOf, type Channel, type Computer, type TermLink, type TermTab, type TermWatch } from "~/model"
import { shown } from "~/names"
import { useApp, type TermOf } from "~/nav"
import { colorsOf, useSystemDark } from "~/theme/apply"
import { activeTheme } from "~/theme/themes"

const SCROLLBACK = 3_000
const RESIZE_MS = 120
const BROKE_AGAIN_MS = 10_000
const HEIGHT_KEY = "kiwi.term.height"
const MIN_HEIGHT = 180
const CELL = 8
const FONT = '"SF Mono", SFMono-Regular, Menlo, "DejaVu Sans Mono", ui-monospace, monospace'
const TABS_MS = 2_000
const REMOTE_TABS_MS = 30_000
const RETRY_FIRST_MS = 1_000
const RETRY_FOR_MS = 120_000

type Phase = { kind: "opening" } | { kind: "live"; cols: number; rows: number } | { kind: "ended"; cols: number; rows: number } | { kind: "reconnecting" } | { kind: "error"; why: string }

interface Want {
  pane: string | null
  machine: string | null
  n: number
}

const isPhone = (c: Computer): boolean => c.os === "iphone" || c.os === "android"

const tabKey = (t: { pane: string | null; machine?: string | null }): string => `${t.machine ?? ""}:${t.pane ?? ""}`

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

async function fontOf(css: CSSStyleDeclaration): Promise<{ family: string; advance: number }> {
  const family = css.getPropertyValue("--mono").trim() || FONT
  await document.fonts.load(`16px ${family}`).catch(() => [])
  const ctx = document.createElement("canvas").getContext("2d")
  if (!ctx) return { family, advance: 0.6 }
  ctx.font = `100px ${family}`
  return { family, advance: ctx.measureText("0").width / 100 || 0.6 }
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
  const { app, go, toast } = useApp()
  const name = of.kind === "agent" ? of.name : null
  const person = name ? memberOf(channel, name) : undefined
  const title = name === null ? "Your terminal" : person ? shown(person) : name
  const host = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>({ kind: "opening" })
  const [height, setHeight] = useState<number | null>(storedHeight)
  const [want, setWant] = useState<Want>({ pane: null, machine: null, n: 0 })
  const [current, setCurrent] = useState<{ pane: string; machine: string | null } | null>(null)
  const [tabs, setTabs] = useState<TermTab[]>([])
  const [away, setAway] = useState<ReadonlyMap<string, TermTab[]>>(new Map())
  const others = (app.account?.computers ?? []).filter((c) => !c.thisOne && !isPhone(c))
  const labelOf = (machine: string | null | undefined): string => (machine ? (others.find((c) => c.id === machine)?.label ?? "another computer") : "This computer")
  const retry = useRef<{ since: number; wait: number; timer: number } | null>(null)
  const plusAt = useRef<HTMLSpanElement>(null)
  const systemDark = useSystemDark()
  const theme = activeTheme(app.prefs, systemDark)
  const looks = `${theme.id}:${JSON.stringify(colorsOf(theme))}`
  const ended = useRef<() => void>(() => {})
  const lost = useRef<() => void>(() => {})
  const seen = useRef<(machine: string) => void>(() => {})
  const last = useRef<{ n: number; pane: string | null; machine: string | null }>({ n: 0, pane: null, machine: null })
  const brokeAt = useRef(0)

  const pick = (pane: string | null, machine: string | null = null) => setWant((w) => ({ pane, machine, n: w.n + 1 }))
  const everyTab = (here: TermTab[], there: ReadonlyMap<string, TermTab[]>): TermTab[] => [...here, ...[...there.values()].flat()]
  const settle = (here: TermTab[], there: ReadonlyMap<string, TermTab[]>, gone: { pane: string; machine: string | null } | null) => {
    setTabs(here)
    setAway(there)
    if (!gone || !current || tabKey(gone) !== tabKey(current)) return
    const next = everyTab(here, there)[0]
    if (next) pick(next.pane, next.machine ?? null)
    else go({ to: "term", term: null })
  }
  const lookAway = async (machine: string): Promise<ReadonlyMap<string, TermTab[]>> => {
    const next: ReadonlyMap<string, TermTab[]> = new Map([...away, [machine, await app.actions.remoteTerms(machine)]])
    setAway(next)
    return next
  }
  useEffect(() => {
    seen.current = (machine) => void lookAway(machine)
    ended.current = () => {
      if (name !== null) return
      const machine = current?.machine ?? null
      if (machine) void lookAway(machine).then((there) => settle(tabs, there, current))
      else void app.actions.myTerms().then((left) => settle(left, away, current))
    }
    lost.current = () => {
      const at = current
      if (!at?.machine) return ended.current()
      const now = Date.now()
      const r = retry.current ?? { since: now, wait: RETRY_FIRST_MS, timer: 0 }
      if (now - r.since > RETRY_FOR_MS) {
        retry.current = null
        setPhase({ kind: "error", why: `${labelOf(at.machine)} is offline. Your shell keeps running there.` })
        return
      }
      setPhase({ kind: "reconnecting" })
      window.clearTimeout(r.timer)
      r.timer = window.setTimeout(() => pick(at.pane, at.machine), r.wait)
      r.wait = Math.min(r.wait * 2, 15_000)
      retry.current = r
    }
  })
  useEffect(() => () => window.clearTimeout(retry.current?.timer), [])

  useEffect(() => {
    if (name !== null) return
    let live = true
    const look = () => void app.actions.myTerms().then((t) => live && setTabs(t))
    look()
    const every = window.setInterval(look, TABS_MS)
    return () => {
      live = false
      window.clearInterval(every)
    }
  }, [app.actions, name])

  const reachable = others
    .filter((c) => c.online)
    .map((c) => c.id)
    .join(",")
  useEffect(() => {
    if (name !== null || !reachable) return
    let live = true
    const look = () => {
      for (const machine of reachable.split(",")) void app.actions.remoteTerms(machine).then((t) => live && setAway((m) => new Map([...m, [machine, t]])))
    }
    look()
    const every = window.setInterval(look, REMOTE_TABS_MS)
    return () => {
      live = false
      window.clearInterval(every)
    }
  }, [app.actions, name, reachable])

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
        const font = await fontOf(css)
        if (gone) return
        const t = new Terminal({ ghostty: g, fontSize: (Math.round(CELL * scale) - 0.02) / font.advance, fontFamily: font.family, theme: themeOf(css), scrollback: SCROLLBACK, cursorBlink: false })
        term = t
        const fit = new FitAddon()
        t.loadAddon(fit)
        t.open(el)
        const broke = () => {
          if (gone) return
          gone = true
          window.clearTimeout(timer)
          observer?.disconnect()
          link?.close()
          link = null
          term = null
          t.dispose()
          el.replaceChildren()
          const now = Date.now()
          const again = now - brokeAt.current < BROKE_AGAIN_MS
          brokeAt.current = now
          if (again) setPhase({ kind: "error", why: "The terminal stopped drawing. Close it and open it again." })
          else pick(last.current.pane, last.current.machine)
        }
        const safely = (draw: () => void) => {
          try {
            draw()
          } catch {
            // The terminal engine broke mid-draw; drawing on would freeze the page, so it opens afresh.
            broke()
          }
        }
        const watch: TermWatch = {
          out: (text) => {
            if (text) safely(() => t.write(text))
          },
          ended: () => {
            setPhase((p) => (p.kind === "live" ? { ...p, kind: "ended" } : p))
            ended.current()
          },
          lost: () => {
            if (!gone) lost.current()
          },
        }
        const size = fit.proposeDimensions() ?? { cols: 100, rows: 30 }
        const again = last.current.n === want.n
        const target = again ? last.current.pane : want.pane
        const machine = again ? last.current.machine : want.machine
        const opened =
          name === null
            ? await app.actions.openMyTerm(channel.code, target, size.cols, size.rows, watch, machine ?? undefined)
            : await app.actions.openTerm(channel.code, name, size.cols, size.rows, watch)
        if (gone) {
          if ("link" in opened) opened.link.close()
          return
        }
        if ("error" in opened) {
          if (retry.current && machine) {
            last.current = { n: want.n, pane: target, machine }
            lost.current()
            return
          }
          setPhase({ kind: "error", why: opened.error })
          return
        }
        retry.current = null
        const l = opened.link
        link = l
        last.current = { n: want.n, pane: opened.screen.pane ?? null, machine }
        setCurrent(opened.screen.pane ? { pane: opened.screen.pane, machine } : null)
        if (machine) seen.current(machine)
        if (name === null && !machine) void app.actions.myTerms().then((t) => !gone && setTabs(t))
        safely(() => {
          t.resize(opened.screen.cols, opened.screen.rows)
          if (opened.screen.seed) t.write(opened.screen.seed)
        })
        if (gone) return
        setPhase({ kind: opened.screen.dead ? "ended" : "live", cols: opened.screen.cols, rows: opened.screen.rows })
        t.onData((data) => l.keys(data))
        t.focus()
        observer = new ResizeObserver(() => {
          window.clearTimeout(timer)
          timer = window.setTimeout(() => {
            const next = fit.proposeDimensions()
            if (gone || !next || (next.cols === t.cols && next.rows === t.rows)) return
            safely(() => t.resize(next.cols, next.rows))
            if (gone) return
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
      el.replaceChildren()
    }
  }, [app.actions, channel.code, name, want, looks])

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
  const all = everyTab(tabs, away)
  const tabName = (t: TermTab): string => (t.machine ? `${labelOf(t.machine)} · ${t.label}` : t.label)
  const closeTab = (t: TermTab) => {
    const at = { pane: t.pane, machine: t.machine ?? null }
    if (t.machine) void app.actions.closeRemoteTerm(t.machine, t.pane).then((left) => settle(tabs, new Map([...away, [t.machine!, left]]), at))
    else void app.actions.closeMyTerm(t.pane).then((left) => settle(left, away, at))
  }
  const plus = () => {
    const r = plusAt.current?.getBoundingClientRect()
    if (!others.length || !r) return pick("new")
    openMenu.set({
      x: r.left,
      y: r.bottom + 4,
      label: "New terminal on",
      groups: [
        [
          { label: "This computer", run: () => pick("new") },
          ...others.map((c) => ({ label: c.online ? c.label : `${c.label} · offline`, run: () => pick("new", c.id), ...(c.online ? {} : { disabled: true as const }) })),
        ],
      ],
    })
  }
  return (
    <section className="term" aria-label={name === null ? title : `${title}'s terminal`} style={height ? { height } : undefined} onKeyDown={(e) => e.stopPropagation()}>
      <div className="term-grip" role="separator" aria-orientation="horizontal" aria-label="Resize the terminal" onPointerDown={grip} onDoubleClick={() => setHeight(null)} />
      <header className="term-head" title={[name === null ? labelOf(current?.machine) : "Channels' tmux", size].filter(Boolean).join(" · ")}>
        {name !== null ? (
          <Avatar person={person} size="sm" />
        ) : (
          all.length === 0 && (
            <span className="term-mine" aria-hidden="true">
              <Icon name="terminal" size={14} />
            </span>
          )
        )}
        {name === null && all.length > 0 ? (
          <div className="term-tabs" role="tablist" aria-label="Your terminals">
            {all.map((t) => {
              const on = !!current && tabKey(current) === tabKey(t)
              return (
                <span key={tabKey(t)} className={cx("term-tab", on && "is-on")}>
                  <button type="button" role="tab" aria-selected={on} onClick={() => pick(t.pane, t.machine ?? null)}>
                    {tabName(t)}
                  </button>
                  <button type="button" className="term-tab-x" aria-label={`Close ${tabName(t)} (ends that shell)`} onClick={() => closeTab(t)}>
                    <Icon name="close" size={10} />
                  </button>
                </span>
              )
            })}
            <span ref={plusAt} className="term-plus">
              <IconButton icon="plus" label={others.length ? "New terminal on…" : "New terminal"} onClick={plus} />
            </span>
          </div>
        ) : (
          <span className="term-name">{title}</span>
        )}
        <span className="term-where">{phase.kind === "ended" && <span className="term-ended">exited</span>}</span>
        {name !== null && <IconButton icon="external" label="Open in your terminal" onClick={() => void app.actions.showAgent(channel.code, name).then((note) => note && toast(note))} />}
        <IconButton icon="down" label={name === null ? "Hide the terminal · your shells keep running" : "Hide the terminal · the agent keeps running"} onClick={() => go({ to: "term", term: null })} />
      </header>
      <div className="term-screen" ref={host} />
      {phase.kind === "opening" && <p className="term-note">Opening…</p>}
      {phase.kind === "reconnecting" && <p className="term-note">Reconnecting…</p>}
      {phase.kind === "error" && (
        <p className="term-note is-error" role="alert">
          {phase.why}
        </p>
      )}
    </section>
  )
}
