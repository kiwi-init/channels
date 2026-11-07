import "~/styles/afk.css"

import { bridge } from "@kiwi/secrets/secrets.ts"
import { useEffect, useRef, useState, type AnimationEvent } from "react"

import { cx } from "~/kit/bits"
import { MOD_PROTOCOL } from "~/mods/protocol"
import { daylight, type Rgb } from "~/start/daylight"

const SWALLOWED = ["keydown", "keyup", "wheel", "pointerdown", "contextmenu"] as const

const unframe = (): void => {
  if (document.activeElement instanceof HTMLIFrameElement) window.focus()
}

const FRAME_URL = "views://internal/mod-frame.html#afk-scene"
const READY_MS = 8_000

const css = (c: Rgb): string => `rgb(${c.map((v) => Math.round(v * 255)).join(" ")})`

async function sceneHtml(): Promise<string | null> {
  const b = bridge()
  if (typeof b?.afkScene !== "function") return null
  const got = await b.afkScene()
  if (got.html !== null || !got.first || typeof b.keepAfkScene !== "function") return got.html
  const made = await fetch(new URL("afk-scene.html", location.href))
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null)
  return made === null ? null : b.keepAfkScene(made)
}

export interface AfkProps {
  name: string
  leaving: boolean
  scene: boolean
  needs: number
  still: boolean
  slot: (el: HTMLElement | null) => void
  frame: () => HTMLIFrameElement | null
  leave: () => void
  gone: () => void
}

export function Afk({ name, leaving, scene, needs, still, slot, frame, leave, gone }: AfkProps) {
  const box = useRef<HTMLDivElement>(null)
  const sceneFrame = useRef<HTMLIFrameElement>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [sky] = useState(() => daylight(new Date()).look)

  useEffect(() => {
    slot(box.current)
    return () => slot(null)
  }, [slot])

  useEffect(() => {
    const was = document.activeElement instanceof HTMLElement ? document.activeElement : null
    let framed = false
    const hold = (): void => {
      if (framed) window.focus()
      else unframe()
      box.current?.focus({ preventScroll: true })
    }
    const keep = (): void => {
      if (framed || document.activeElement !== box.current) hold()
    }
    const later = (): void => void setTimeout(keep, 0)
    const blurred = (e: Event): void => {
      if (e.target !== window) return
      framed = document.hasFocus()
      later()
    }
    const focused = (e: Event): void => {
      if (e.target === window) framed = false
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
    window.addEventListener("blur", blurred)
    window.addEventListener("focus", focused)
    document.addEventListener("focusin", later, true)
    el?.addEventListener("focusout", later)
    return () => {
      window.clearInterval(every)
      for (const type of SWALLOWED) window.removeEventListener(type, swallow, { capture: true })
      window.removeEventListener("blur", blurred)
      window.removeEventListener("focus", focused)
      document.removeEventListener("focusin", later, true)
      el?.removeEventListener("focusout", later)
      unframe()
      if (was?.isConnected && was !== document.body && was !== frame()) was.focus({ preventScroll: true })
    }
  }, [frame, leave])

  useEffect(() => {
    if (!scene) return
    let off = false
    sceneHtml()
      .then((got) => {
        if (!off) setHtml(got)
      })
      .catch(() => {
        // A scene file that can't be read leaves the plain sky.
      })
    return () => {
      off = true
    }
  }, [scene])

  useEffect(() => {
    if (html === null) return
    const heard = (e: MessageEvent): void => {
      const m = e.data as { kiwi?: unknown; type?: unknown } | null
      if (e.source && e.source === sceneFrame.current?.contentWindow && m?.kiwi === "afk" && m.type === "ready") setReady(true)
    }
    addEventListener("message", heard)
    return () => removeEventListener("message", heard)
  }, [html])

  useEffect(() => {
    if (html === null || ready) return
    const late = window.setTimeout(() => setHtml(null), READY_MS)
    return () => window.clearTimeout(late)
  }, [html, ready])

  useEffect(() => {
    sceneFrame.current?.contentWindow?.postMessage({ kiwi: "afk", type: "state", at: Date.now(), needs, still }, "*")
  }, [needs, still, ready])

  const boot = (): void => {
    const to = sceneFrame.current?.contentWindow
    if (html === null || !to) return
    to.postMessage({ kiwi: MOD_PROTOCOL, type: "scene", html }, "*")
    to.postMessage({ kiwi: "afk", type: "state", at: Date.now(), needs, still }, "*")
  }

  const ended = (e: AnimationEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget || e.animationName !== "afk-out") return
    unframe()
    box.current?.focus({ preventScroll: true })
    gone()
  }

  return (
    <div
      ref={box}
      className={cx("afk", leaving && "is-leaving")}
      style={{ background: `linear-gradient(${css(sky.top)}, ${css(sky.low)} 70%, ${css(sky.haze)})` }}
      data-scene={html === null ? "plain" : ready ? "ready" : "starting"}
      role="dialog"
      aria-modal="true"
      aria-label={name}
      tabIndex={-1}
      onAnimationEnd={ended}
    >
      {html !== null && (
        <iframe ref={sceneFrame} className={cx("afk-back", ready && "is-ready")} src={FRAME_URL} sandbox="allow-scripts" title="AFK scene" tabIndex={-1} aria-hidden="true" onLoad={boot} />
      )}
    </div>
  )
}
