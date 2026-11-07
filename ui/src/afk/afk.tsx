import "~/styles/afk.css"

import { useEffect, useMemo, useRef, useState, type AnimationEvent } from "react"

import { AFK_FRAME_URL, afkBackdrop, plainSky, READY_MS, type Backdrop } from "~/afk/backdrop"
import { hideAfk } from "~/afk/wait"
import type { Meadow } from "~/afk/meadow"
import { afkRows, type AfkRow } from "~/afk/rows"
import { Settle, useStill } from "~/afk/settle"
import { Count, cx } from "~/kit/bits"
import { useApp } from "~/nav"

const SWALLOWED = ["keydown", "keyup", "wheel", "pointerdown", "contextmenu"] as const

function Row({ row, still, open }: { row: AfkRow; still: boolean; open: (code: string) => void }) {
  const needs = row.needs > 0
  const label = `${row.title}${needs ? `, ${row.needs} ${row.needs === 1 ? "needs" : "need"} you` : ""}, ${row.line ?? "quiet"}`
  return (
    <li>
      <button type="button" className={cx("afk-row", needs && "is-news")} aria-label={label} onClick={() => open(row.code)}>
        <span className="afk-mark">{needs ? <Count n={row.needs} loud /> : "·"}</span>
        <span className="afk-name">
          <Settle text={row.title} still={still} />
        </span>
        <span className={cx("afk-line", !row.line && "is-quiet")}>
          <Settle text={row.line ?? "quiet"} still={still} />
        </span>
      </button>
    </li>
  )
}

export function Afk() {
  const { app, go } = useApp()
  const rows = useMemo(() => afkRows(app.channels, app.home), [app.channels, app.home])
  const still = useStill()
  const [leaving, setLeaving] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const meadow = useRef<Meadow | null>(null)
  const latest = useRef({ rows, still, leaving })
  const total = rows.reduce((a, r) => a + r.needs, 0)
  const [back, setBack] = useState<Backdrop | null>(null)
  const [ready, setReady] = useState(false)
  const [sky] = useState(() => plainSky(new Date()))
  const sceneFrame = useRef<HTMLIFrameElement>(null)
  const html = back?.kind === "scene" ? back.html : null
  const meadowOn = back?.kind === "meadow"

  useEffect(() => {
    const was = document.activeElement instanceof HTMLElement ? document.activeElement : null
    box.current?.focus({ preventScroll: true })
    const swallow = (e: Event): void => {
      if (e.type === "pointerdown" && e.target instanceof Element && e.target.closest(".afk-row")) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.type !== "keyup") setLeaving(true)
    }
    for (const type of SWALLOWED) window.addEventListener(type, swallow, { capture: true, passive: false })
    return () => {
      for (const type of SWALLOWED) window.removeEventListener(type, swallow, { capture: true })
      if (was?.isConnected) was.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    latest.current = { rows, still, leaving }
  }, [rows, still, leaving])

  useEffect(() => {
    let off = false
    afkBackdrop()
      .then((b) => {
        if (!off) setBack(b)
      })
      .catch(() => {
        // A scene that can't be read or kept falls back to the meadow built into the app.
        if (!off) setBack({ kind: "meadow" })
      })
    return () => {
      off = true
    }
  }, [])

  useEffect(() => {
    if (html === null) return
    const heard = (e: MessageEvent): void => {
      const m = e.data as { kiwi?: unknown; type?: unknown } | null
      if (e.source && e.source === sceneFrame.current?.contentWindow && m?.kiwi === "afk" && m.type === "ready") setReady(true)
    }
    const pull = (): void => {
      if (document.activeElement !== sceneFrame.current) return
      window.focus()
      box.current?.focus({ preventScroll: true })
    }
    const blurred = (e: Event): void => {
      if (e.target === window) window.setTimeout(pull, 0)
    }
    const every = window.setInterval(pull, 50)
    addEventListener("message", heard)
    window.addEventListener("blur", blurred)
    return () => {
      window.clearInterval(every)
      removeEventListener("message", heard)
      window.removeEventListener("blur", blurred)
    }
  }, [html])

  useEffect(() => {
    if (html === null || ready) return
    const late = window.setTimeout(() => setBack({ kind: "plain" }), READY_MS)
    return () => window.clearTimeout(late)
  }, [html, ready])

  useEffect(() => {
    sceneFrame.current?.contentWindow?.postMessage({ kiwi: "afk", type: "state", at: Date.now(), needs: total, still }, "*")
  }, [total, still, ready])

  useEffect(() => {
    if (!meadowOn) return
    let gone = false
    void import("~/afk/meadow")
      .then(({ startMeadow }) => {
        if (gone || !stage.current) return null
        return startMeadow(stage.current, latest.current.still)
      })
      .then((m) => {
        if (!m) return
        if (gone) return m.dispose()
        meadow.current = m
        m.setAlert(latest.current.rows.some((r) => r.needs > 0))
        if (latest.current.leaving) m.freeze()
      })
      .catch(() => {
        // A scene that can't start leaves the haze, and the panel over it still reads.
      })
    return () => {
      gone = true
      meadow.current?.dispose()
      meadow.current = null
    }
  }, [meadowOn])

  useEffect(() => meadow.current?.setAlert(rows.some((r) => r.needs > 0)), [rows])
  useEffect(() => meadow.current?.setStill(still), [still])
  useEffect(() => {
    if (leaving) meadow.current?.freeze()
  }, [leaving])

  const open = (code: string): void => {
    go({ to: "channel", code })
    setLeaving(true)
  }
  const boot = (): void => {
    const to = sceneFrame.current?.contentWindow
    if (html === null || !to) return
    to.postMessage({ kiwi: "afk", type: "scene", html }, "*")
    to.postMessage({ kiwi: "afk", type: "state", at: Date.now(), needs: total, still }, "*")
  }
  const ended = (e: AnimationEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && e.animationName === "afk-out") hideAfk()
  }

  return (
    <div
      ref={box}
      className={cx("afk", leaving && "is-leaving")}
      style={back && !meadowOn ? { background: sky } : undefined}
      data-scene={back === null ? "starting" : back.kind === "scene" ? (ready ? "ready" : "starting") : back.kind}
      role="dialog"
      aria-modal="true"
      aria-label="AFK"
      tabIndex={-1}
      onAnimationEnd={ended}
    >
      {html !== null ? (
        <iframe
          ref={sceneFrame}
          className={cx("afk-back afk-scene", ready && "is-ready")}
          src={AFK_FRAME_URL}
          sandbox="allow-scripts"
          title="AFK scene"
          tabIndex={-1}
          aria-hidden="true"
          onLoad={boot}
        />
      ) : (
        <div ref={stage} className="afk-back" aria-hidden="true" />
      )}
      <section className="afk-glance" aria-label="What needs you">
        {total > 0 ? (
          <p className="afk-count">
            Needs you <Count n={total} loud />
          </p>
        ) : (
          <p className="afk-clear">Nothing needs you. Enjoy your time, or go worry about something else.</p>
        )}
        <ul className="afk-list" aria-label="Channels">
          {rows.map((r) => (
            <Row key={r.code} row={r} still={still} open={open} />
          ))}
        </ul>
      </section>
    </div>
  )
}
