import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { bridge } from "@kiwi/secrets/secrets.ts"
import { bytesOf } from "~/chat/doc/bytes"
import { Icon } from "~/kit/icons"
import type { DocFile } from "~/model"
import { useAct } from "~/nav"
import { look, modsNow, runningMod, useModsVersion } from "~/mods/host"
import { fromFrame, MOD_PROTOCOL, type ToFrame } from "~/mods/protocol"
import { LIVE_MAX, type ShownFiles } from "~/mods/shown"
import "~/styles/shown.css"

const FRAME_URL = "views://internal/mod-frame.html"

interface Drawn {
  mod: string
  kind: string
  name: string
  full: boolean
  page: () => Promise<string | null>
  booted: boolean
  ready: boolean
  done: (ok: boolean) => void
}

type Snap = { state: "loading" } | { state: "gone"; why: string } | { state: "shown"; url: string; width: number; height: number }

const drawn = new Map<HTMLIFrameElement, Drawn>()
const taken = new Set<object>()
const waiting = new Set<() => void>()
let listening = false

const send = (el: HTMLIFrameElement, m: ToFrame): void => el.contentWindow?.postMessage(m, "*")

async function onMessage(e: MessageEvent): Promise<void> {
  const at = [...drawn].find(([el]) => el.contentWindow === e.source)
  const m = at ? fromFrame(e.data) : null
  const b = bridge()
  if (!at || !m || !b) return
  const [el, d] = at
  switch (m.type) {
    case "hello": {
      if (d.booted) return
      d.booted = true
      const [got, html] = await Promise.all([b.modBundle(d.mod).catch(() => null), d.page().catch(() => null)])
      if (!got || html === null) return d.done(false)
      send(el, { kiwi: MOD_PROTOCOL, type: "boot", name: d.mod, code: got.code, ...look(), shown: { kind: d.kind, name: d.name, html, full: d.full } })
      return
    }
    case "ready":
      if (!d.ready) d.done((d.ready = true))
      return
    case "error":
      if (!d.ready) d.done(false)
      return
    case "fetch": {
      const reply: ToFrame = await b.modFetch(d.mod, { url: m.url, ...m.init }).then(
        (value) => ({ kiwi: MOD_PROTOCOL, type: "reply", id: m.id, ok: true, value }),
        (err: unknown) => ({ kiwi: MOD_PROTOCOL, type: "reply", id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) })
      )
      send(el, reply)
    }
  }
}

function listen(): void {
  if (listening) return
  listening = true
  addEventListener("message", (e) => void onMessage(e))
}

const still = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches

function canDraw(mod: string): boolean {
  const b = bridge()
  const run = runningMod(mod)
  return typeof b?.modBundle === "function" && !!run && !run.failed && modsNow().some((m) => m.name === mod && m.state === "on")
}

function useDark(): boolean {
  const [dark, setDark] = useState(() => look().dark)
  useEffect(() => {
    const sync = () => setDark(look().dark)
    const media = matchMedia("(prefers-color-scheme: dark)")
    const seen = new MutationObserver(sync)
    seen.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    media.addEventListener("change", sync)
    return () => {
      seen.disconnect()
      media.removeEventListener("change", sync)
    }
  }, [])
  return dark
}

function DrawnFrame({ code, shown, mod, dark, full, onDone }: { code: string; shown: ShownFiles<DocFile>; mod: string; dark: boolean; full: boolean; onDone: (ok: boolean) => void }) {
  const { actions } = useAct()
  const ref = useRef<HTMLIFrameElement>(null)
  const done = useRef(onDone)
  useLayoutEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const file = !dark && shown.light ? shown.light : shown.page
    listen()
    drawn.set(el, {
      mod,
      kind: shown.kind,
      name: shown.name,
      full,
      booted: false,
      ready: false,
      page: () => actions.docFile(code, file).then((data) => (data === null ? null : new TextDecoder().decode(bytesOf(data)))),
      done: (ok) => done.current(ok),
    })
    el.src = FRAME_URL
    return () => void drawn.delete(el)
  }, [actions, code, shown, mod, dark, full])
  return <iframe ref={ref} className={full ? "shown-full-frame" : "msg-shown-frame"} title={shown.name} sandbox="allow-scripts" />
}

export function ShownView({ code, shown, mod }: { code: string; shown: ShownFiles<DocFile>; mod: string }) {
  const { actions } = useAct()
  useModsVersion()
  const box = useRef<HTMLDivElement>(null)
  const dark = useDark()
  const [snap, setSnap] = useState<Snap>({ state: "loading" })
  const [near, setNear] = useState(false)
  const [slot, setSlot] = useState(false)
  const [live, setLive] = useState(false)
  const [broken, setBroken] = useState(false)
  const [full, setFull] = useState(false)
  const drawable = canDraw(mod) && !broken
  const inline = drawable && snap.state === "shown" && !still()

  useEffect(() => {
    let on = true
    let url: string | null = null
    actions.docFile(code, shown.snapshot).then(
      (data) => {
        if (!on) return
        if (data === null) return setSnap({ state: "gone", why: `${shown.name} is no longer available` })
        const made = URL.createObjectURL(new Blob([bytesOf(data)], { type: "image/svg+xml" }))
        url = made
        const img = new Image()
        img.onload = () => on && setSnap({ state: "shown", url: made, width: img.naturalWidth || 640, height: img.naturalHeight || 400 })
        img.onerror = () => on && setSnap({ state: "gone", why: `${shown.name} didn't load` })
        img.src = made
      },
      () => on && setSnap({ state: "gone", why: `${shown.name} didn't load` })
    )
    return () => {
      on = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [actions, code, shown])

  useEffect(() => {
    const el = box.current
    if (!el || !inline) return
    const seen = new IntersectionObserver((es) => setNear(es[es.length - 1]?.isIntersecting ?? false), { rootMargin: "50% 0px" })
    seen.observe(el)
    return () => {
      seen.disconnect()
      setNear(false)
    }
  }, [inline])

  useEffect(() => {
    if (!near || !inline) return
    const token = {}
    const take = () => {
      if (taken.has(token) || taken.size >= LIVE_MAX) return
      taken.add(token)
      setSlot(true)
    }
    take()
    waiting.add(take)
    return () => {
      waiting.delete(take)
      setSlot(false)
      setLive(false)
      if (taken.delete(token)) for (const next of [...waiting]) next()
    }
  }, [near, inline])

  if (snap.state !== "shown")
    return (
      <span className="msg-image-spot" title={shown.name} role="status">
        {snap.state === "gone" ? snap.why : "Loading figure…"}
      </span>
    )
  const done = (ok: boolean) => (ok ? setLive(true) : setBroken(true))
  return (
    <div ref={box} className={live ? "msg-shown is-live" : "msg-shown"} style={{ aspectRatio: `${snap.width} / ${snap.height}`, maxWidth: `${snap.width}px` }}>
      <img src={snap.url} alt={shown.name} draggable={false} />
      {slot && <DrawnFrame key={dark ? "dark" : "light"} code={code} shown={shown} mod={mod} dark={dark} full={false} onDone={done} />}
      <button type="button" className="msg-shown-open" aria-label={`Open ${shown.name} full window`} title="Full window" onClick={() => setFull(true)}>
        <Icon name="expand" size={14} />
      </button>
      {full && (
        <dialog ref={(el) => void (el && !el.open && el.showModal())} className="shown-full" aria-label={shown.name} onClose={() => setFull(false)}>
          {drawable ? (
            <DrawnFrame key={dark ? "dark" : "light"} code={code} shown={shown} mod={mod} dark={dark} full onDone={() => {}} />
          ) : (
            <img className="shown-full-frame" src={snap.url} alt={shown.name} />
          )}
          <button type="button" className="shown-full-close" aria-label="Close" title="Close" autoFocus onClick={() => setFull(false)}>
            <Icon name="close" size={16} />
          </button>
        </dialog>
      )}
    </div>
  )
}
