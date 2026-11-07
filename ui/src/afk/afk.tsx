import "~/styles/afk.css"

import { useEffect, useMemo, useRef, useState, type AnimationEvent } from "react"

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
  }, [])

  useEffect(() => meadow.current?.setAlert(rows.some((r) => r.needs > 0)), [rows])
  useEffect(() => meadow.current?.setStill(still), [still])
  useEffect(() => {
    if (leaving) meadow.current?.freeze()
  }, [leaving])

  const open = (code: string): void => {
    go({ to: "channel", code })
    setLeaving(true)
  }
  const ended = (e: AnimationEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && e.animationName === "afk-out") hideAfk()
  }

  return (
    <div ref={box} className={cx("afk", leaving && "is-leaving")} role="dialog" aria-modal="true" aria-label="AFK" tabIndex={-1} onAnimationEnd={ended}>
      <div ref={stage} className="afk-back" aria-hidden="true" />
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
