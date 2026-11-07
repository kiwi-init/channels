import "~/styles/afk.css"

import { useEffect, useMemo, useRef, useState, type AnimationEvent } from "react"

import { hideAfk } from "~/afk/wait"
import { MapView } from "~/afk/map"
import type { Meadow } from "~/afk/meadow"
import { afkRows } from "~/afk/rows"
import { useStill } from "~/afk/settle"
import { cx } from "~/kit/bits"
import { useApp } from "~/nav"

const SWALLOWED = ["keydown", "keyup", "wheel", "pointerdown", "contextmenu"] as const

export function Afk() {
  const { app, go } = useApp()
  const rows = useMemo(() => afkRows(app.channels, app.home), [app.channels, app.home])
  const still = useStill()
  const [leaving, setLeaving] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const meadow = useRef<Meadow | null>(null)
  const latest = useRef({ rows, still, leaving })

  useEffect(() => {
    const was = document.activeElement instanceof HTMLElement ? document.activeElement : null
    box.current?.focus({ preventScroll: true })
    const swallow = (e: Event): void => {
      if (e.type === "pointerdown" && e.target instanceof Element && e.target.closest("[data-afk-open]")) return
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

  const open = (code: string, needs: boolean): void => {
    go({ to: "channel", code })
    if (needs) go({ to: "tab", tab: "needs" })
    setLeaving(true)
  }
  const ended = (e: AnimationEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && e.animationName === "afk-out") hideAfk()
  }

  return (
    <div ref={box} className={cx("afk", leaving && "is-leaving")} role="dialog" aria-modal="true" aria-label="AFK" tabIndex={-1} onAnimationEnd={ended}>
      <div ref={stage} className="afk-back" aria-hidden="true" />
      <MapView open={open} />
    </div>
  )
}
