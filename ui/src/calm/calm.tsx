import "~/styles/calm.css"

import { useEffect, useMemo, useRef, useState, type AnimationEvent } from "react"

import { hideCalm } from "~/calm/idle"
import type { Meadow } from "~/calm/meadow"
import { calmRows, type CalmRow } from "~/calm/rows"
import { cx } from "~/kit/bits"
import { useApp } from "~/nav"

const SWALLOWED = ["keydown", "keyup", "wheel", "pointerdown", "contextmenu"] as const
const STILL = "(prefers-reduced-motion: reduce)"

function useStill(): boolean {
  const [still, setStill] = useState(() => window.matchMedia(STILL).matches)
  useEffect(() => {
    const query = window.matchMedia(STILL)
    const changed = (): void => setStill(query.matches)
    query.addEventListener("change", changed)
    return () => query.removeEventListener("change", changed)
  }, [])
  return still
}

function Settle({ text, still }: { text: string; still: boolean }) {
  const [shown, setShown] = useState(() => (still ? text : ""))
  useEffect(() => {
    if (still) return
    const t0 = performance.now()
    let raf = 0
    const step = (): void => {
      const age = (performance.now() - t0) / 1000
      let out = ""
      for (let i = 0; i < text.length; i++) {
        const a = age - i / 70
        const ch = text[i] ?? ""
        out += ch === " " || a > 0.1 ? ch : a > -0.25 ? String.fromCharCode(97 + Math.floor(Math.random() * 26)) : ""
      }
      setShown(out)
      if (age < text.length / 70 + 0.15) raf = requestAnimationFrame(step)
      else setShown(text)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [text, still])
  return <>{still ? text : shown}</>
}

function Row({ row, still, open }: { row: CalmRow; still: boolean; open: (code: string) => void }) {
  const needs = row.needs > 0
  const count = row.needs > 99 ? "99+" : String(row.needs)
  const label = `${row.title}${needs ? `, ${row.needs} ${row.needs === 1 ? "needs" : "need"} you` : ""}, ${row.line ?? "quiet"}`
  return (
    <li>
      <button type="button" className={cx("rest-row", needs && "is-news")} aria-label={label} onClick={() => open(row.code)}>
        <span className="rest-mark">{needs ? count : "·"}</span>
        <span className="rest-name">
          <Settle text={row.title} still={still} />
        </span>
        <span className={cx("rest-line", !row.line && "is-quiet")}>
          <Settle text={row.line ?? "quiet"} still={still} />
        </span>
      </button>
    </li>
  )
}

export function Calm() {
  const { app, go } = useApp()
  const rows = useMemo(() => calmRows(app.channels, app.home), [app.channels, app.home])
  const still = useStill()
  const [leaving, setLeaving] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const meadow = useRef<Meadow | null>(null)
  const latest = useRef({ rows, still })
  const total = rows.reduce((a, r) => a + r.needs, 0)

  useEffect(() => {
    const was = document.activeElement instanceof HTMLElement ? document.activeElement : null
    box.current?.focus({ preventScroll: true })
    const swallow = (e: Event): void => {
      if (e.type === "pointerdown" && e.target instanceof Element && e.target.closest(".rest-row")) return
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
    latest.current = { rows, still }
  }, [rows, still])

  useEffect(() => {
    let gone = false
    void import("~/calm/meadow")
      .then(({ startMeadow }) => {
        if (gone || !stage.current) return null
        return startMeadow(stage.current, latest.current.still)
      })
      .then((m) => {
        if (!m) return
        if (gone) return m.dispose()
        meadow.current = m
        m.setRows(latest.current.rows)
      })
      .catch(() => {
        // A scene that can't start leaves the haze, and the panel over it still reads.
      })
    return () => {
      gone = true
      meadow.current?.dispose()
      meadow.current = null
    }
  }, [])

  useEffect(() => meadow.current?.setRows(rows), [rows])
  useEffect(() => meadow.current?.setStill(still), [still])

  const open = (code: string): void => {
    go({ to: "channel", code })
    setLeaving(true)
  }
  const ended = (e: AnimationEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && e.animationName === "rest-out") hideCalm()
  }

  return (
    <div ref={box} className={cx("rest", leaving && "is-leaving")} role="dialog" aria-modal="true" aria-label="Calm" tabIndex={-1} onAnimationEnd={ended}>
      <div ref={stage} className="rest-back" aria-hidden="true" />
      <section className="rest-glance" aria-label="What needs you">
        {total > 0 ? (
          <p className="rest-count">
            <span className="rest-num">{total > 99 ? "99+" : total}</span>
            <span className="rest-label">{total === 1 ? "needs you" : "need you"}</span>
          </p>
        ) : (
          <p className="rest-calm">Nothing needs you. Enjoy your time, or go worry about something else.</p>
        )}
        <ul className="rest-list" aria-label="Channels">
          {rows.map((r) => (
            <Row key={r.code} row={r} still={still} open={open} />
          ))}
        </ul>
      </section>
    </div>
  )
}
