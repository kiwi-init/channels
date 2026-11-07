import "~/styles/calm.css"

import { useEffect, useMemo, useRef, useState, type AnimationEvent } from "react"

import { Glance } from "~/calm/glance"
import { hideCalm } from "~/calm/idle"
import type { Meadow } from "~/calm/meadow"
import { calmRows } from "~/calm/rows"
import { useStill } from "~/calm/settle"
import { cx } from "~/kit/bits"
import { useApp } from "~/nav"

const SWALLOWED = ["keydown", "keyup", "wheel", "pointerdown", "contextmenu"] as const

export function Calm() {
  const { app, nav } = useApp()
  const rows = useMemo(() => calmRows(app.channels, app.home), [app.channels, app.home])
  const still = useStill()
  const [leaving, setLeaving] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const meadow = useRef<Meadow | null>(null)
  const latest = useRef({ rows, still, leaving })
  const opened = useRef(nav)

  useEffect(() => {
    const was = document.activeElement instanceof HTMLElement ? document.activeElement : null
    box.current?.focus({ preventScroll: true })
    const swallow = (e: Event): void => {
      if (e.target instanceof Element && e.target.closest("[data-afk-keep]")) return
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

  useEffect(() => meadow.current?.setRows(rows), [rows])
  useEffect(() => meadow.current?.setStill(still), [still])
  useEffect(() => {
    if (leaving) meadow.current?.freeze()
  }, [leaving])

  useEffect(() => {
    if (nav !== opened.current) setLeaving(true)
  }, [nav])

  const ended = (e: AnimationEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && e.animationName === "rest-out") hideCalm()
  }

  return (
    <div ref={box} className={cx("rest", leaving && "is-leaving")} role="dialog" aria-modal="true" aria-label="Calm" tabIndex={-1} onAnimationEnd={ended}>
      <div ref={stage} className="rest-back" aria-hidden="true" />
      <Glance />
    </div>
  )
}
