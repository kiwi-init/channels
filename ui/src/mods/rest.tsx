import "~/styles/rest.css"

import { useEffect, useRef, type AnimationEvent } from "react"

import { cx } from "~/kit/bits"
import type { Meadow } from "~/start/meadow"

const SWALLOWED = ["keydown", "keyup", "wheel", "pointerdown", "contextmenu"] as const

export interface RestProps {
  name: string
  leaving: boolean
  meadow: boolean
  alert: boolean
  still: boolean
  slot: (el: HTMLElement | null) => void
  frame: () => HTMLIFrameElement | null
  leave: () => void
  gone: () => void
}

export function Rest({ name, leaving, meadow, alert, still, slot, frame, leave, gone }: RestProps) {
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const scene = useRef<Meadow | null>(null)
  const latest = useRef({ alert, still, leaving })

  useEffect(() => {
    latest.current = { alert, still, leaving }
  })

  useEffect(() => {
    slot(box.current)
    return () => slot(null)
  }, [slot])

  useEffect(() => {
    const was = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const hold = (): void => box.current?.focus({ preventScroll: true })
    const keep = (): void => {
      if (document.activeElement !== box.current) hold()
    }
    const later = (): void => {
      keep()
      setTimeout(keep, 0)
    }
    const swallow = (e: Event): void => {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.type !== "keyup") leave()
    }
    const el = box.current
    hold()
    const every = window.setInterval(keep, 50)
    for (const type of SWALLOWED) window.addEventListener(type, swallow, { capture: true, passive: false })
    window.addEventListener("blur", later)
    document.addEventListener("focusin", later, true)
    el?.addEventListener("focusout", later)
    return () => {
      window.clearInterval(every)
      for (const type of SWALLOWED) window.removeEventListener(type, swallow, { capture: true })
      window.removeEventListener("blur", later)
      document.removeEventListener("focusin", later, true)
      el?.removeEventListener("focusout", later)
      frame()?.blur()
      if (was?.isConnected && was !== document.body) was.focus({ preventScroll: true })
    }
  }, [frame, leave])

  useEffect(() => {
    if (!meadow) return
    let off = false
    void import("~/start/meadow")
      .then(({ startMeadow }) => (off || !stage.current ? null : startMeadow(stage.current, latest.current.still)))
      .then((m) => {
        if (!m) return
        if (off) return m.dispose()
        scene.current = m
        m.setAlert(latest.current.alert)
        if (latest.current.leaving) m.freeze()
      })
      .catch(() => {
        // A scene that can't start leaves the haze, and the mod's frame over it still reads.
      })
    return () => {
      off = true
      scene.current?.dispose()
      scene.current = null
    }
  }, [meadow])

  useEffect(() => scene.current?.setAlert(alert), [alert])
  useEffect(() => scene.current?.setStill(still), [still])
  useEffect(() => {
    if (leaving) scene.current?.freeze()
  }, [leaving])

  const ended = (e: AnimationEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget || e.animationName !== "rest-out") return
    box.current?.focus({ preventScroll: true })
    gone()
  }

  return (
    <div ref={box} className={cx("rest", leaving && "is-leaving")} role="dialog" aria-modal="true" aria-label={name} tabIndex={-1} onAnimationEnd={ended}>
      <div ref={stage} className="rest-back" aria-hidden="true" />
    </div>
  )
}
