import "~/styles/calm.css"

import { lazy, Suspense, useEffect, useMemo, useRef, useState, type AnimationEvent } from "react"

import { hideCalm } from "~/calm/idle"
import { calmRows } from "~/calm/rows"
import { cx } from "~/kit/bits"
import { useApp } from "~/nav"

const Sky = lazy(() => import("~/calm/sky"))
const SWALLOWED = ["keydown", "keyup", "wheel", "pointerdown", "contextmenu"] as const

export function Calm() {
  const { app, go } = useApp()
  const rows = useMemo(() => calmRows(app.channels, app.home), [app.channels, app.home])
  const [leaving, setLeaving] = useState(false)
  const box = useRef<HTMLDivElement>(null)

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

  const open = (code: string): void => {
    go({ to: "channel", code })
    setLeaving(true)
  }
  const ended = (e: AnimationEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget && e.animationName === "rest-out") hideCalm()
  }

  return (
    <div ref={box} className={cx("rest", leaving && "is-leaving")} role="dialog" aria-modal="true" aria-label="Calm" tabIndex={-1} onAnimationEnd={ended}>
      <div className="rest-back">
        <Suspense fallback={null}>
          <Sky />
        </Suspense>
      </div>
      <ul className="rest-list">
        {rows.map((r, i) => (
          <li key={r.code} style={{ animationDelay: `${600 + i * 120}ms` }}>
            <button type="button" className={cx("rest-row", r.needs > 0 && "is-news")} onClick={() => open(r.code)}>
              <span className="rest-name">{r.title}</span>
              {r.needs > 0 && <span className="rest-needs">needs you: {r.needs}</span>}
              <span className={cx("rest-line", !r.line && "is-quiet")}>{r.line ?? "quiet"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
