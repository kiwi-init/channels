import { useEffect, useRef, useSyncExternalStore } from "react"

import { bridge } from "@kiwi/secrets/secrets.ts"
import type { ModView } from "../../../desktop/src/bridge.ts"
import { useApp } from "~/nav"
import { openLinksOutside } from "~/kit/outside-links"
import { fromFrame, LOOK, MOD_PROTOCOL, type ModCommand, type ToFrame } from "~/mods/protocol"

const FRAME_URL = "views://internal/mod-frame.html"

export interface RunningMod {
  name: string
  title: string | null
  commands: ModCommand[]
  failed: string | null
}

const state = { mods: [] as ModView[], running: new Map<string, RunningMod>(), slot: null as { name: string; el: HTMLElement } | null }
const frames = new Map<string, HTMLIFrameElement>()
const listeners = new Set<() => void>()
const told = new Set<string>()
let version = 0

const changed = (): void => {
  version++
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export const useModsVersion = (): number => useSyncExternalStore(subscribe, () => version)

export const modsNow = (): ModView[] => state.mods

export const runningMod = (name: string): RunningMod | undefined => state.running.get(name)

export function runModCommand(name: string, id: string): void {
  send(name, { kiwi: MOD_PROTOCOL, type: "command", id })
}

export function showModIn(name: string, el: HTMLElement | null): void {
  if (el) state.slot = { name, el }
  else if (state.slot?.name === name) state.slot = null
  else return
  changed()
}

function send(name: string, m: ToFrame): void {
  frames.get(name)?.contentWindow?.postMessage(m, "*")
}

function look(): { theme: Record<string, string>; dark: boolean } {
  const css = getComputedStyle(document.documentElement)
  const theme: Record<string, string> = {}
  for (const t of LOOK) {
    const v = css.getPropertyValue(`--${t}`).trim()
    if (v) theme[`--${t}`] = v
  }
  const set = document.documentElement.dataset["theme"]
  return { theme, dark: set ? set === "dark" : matchMedia("(prefers-color-scheme: dark)").matches }
}

function update(name: string, patch: Partial<RunningMod>): void {
  const now = state.running.get(name)
  if (!now) return
  state.running.set(name, { ...now, ...patch })
  changed()
}

async function onMessage(e: MessageEvent): Promise<void> {
  const name = [...frames].find(([, f]) => f.contentWindow === e.source)?.[0]
  const m = name ? fromFrame(e.data) : null
  const b = bridge()
  if (!name || !m || !b) return
  if (m.type === "hello") {
    const got = await b.modBundle(name).catch(() => null)
    if (got) send(name, { kiwi: MOD_PROTOCOL, type: "boot", name, code: got.code, ...look() })
    else update(name, { failed: "Its code couldn't be built." })
  } else if (m.type === "ready") update(name, { failed: null })
  else if (m.type === "error") update(name, { failed: m.message })
  else if (m.type === "panel") update(name, { title: m.title })
  else if (m.type === "commands") update(name, { commands: m.list })
  else {
    const reply: ToFrame = await b.modFetch(name, { url: m.url, ...m.init }).then(
      (value) => ({ kiwi: MOD_PROTOCOL, type: "reply", id: m.id, ok: true, value }),
      (err: unknown) => ({ kiwi: MOD_PROTOCOL, type: "reply", id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) })
    )
    send(name, reply)
  }
}

function place(f: HTMLIFrameElement, el: HTMLElement | null): void {
  if (!el) {
    f.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;border:0;visibility:hidden"
    return
  }
  const r = el.getBoundingClientRect()
  f.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:0;z-index:1;background:transparent`
}

function startFrames(layer: HTMLElement): void {
  const on = new Map(state.mods.flatMap((m) => (m.state === "on" && m.hash ? [[m.name, m.hash] as const] : [])))
  for (const [name, f] of frames)
    if (on.get(name) !== f.dataset["hash"]) {
      f.remove()
      frames.delete(name)
      state.running.delete(name)
    }
  for (const [name, hash] of on) {
    if (frames.has(name)) continue
    const f = document.createElement("iframe")
    f.setAttribute("sandbox", "allow-scripts")
    f.title = name
    f.dataset["hash"] = hash
    place(f, null)
    f.src = FRAME_URL
    frames.set(name, f)
    state.running.set(name, { name, title: null, commands: [], failed: null })
    layer.append(f)
  }
}

export function ModsLayer() {
  const layer = useRef<HTMLDivElement>(null)
  const { toast } = useApp()
  useModsVersion()
  useEffect(() => {
    const b = bridge()
    if (!b || typeof b.mods !== "function") return
    openLinksOutside()
    let live = true
    const take = (list: ModView[]) => {
      if (!live) return
      state.mods = list
      for (const m of list)
        if (m.state === "asks" && !told.has(m.name)) {
          told.add(m.name)
          toast(`The mod ${m.name} asks to run. Find it in ⌘K to see what it needs.`)
        }
      if (layer.current) startFrames(layer.current)
      changed()
    }
    void b.mods().then(take, () => take([]))
    const off = b.onMods(take)
    const message = (e: MessageEvent) => void onMessage(e)
    addEventListener("message", message)
    return () => {
      live = false
      off()
      removeEventListener("message", message)
    }
  }, [toast])
  useEffect(() => {
    const sync = () => {
      for (const [name, f] of frames) place(f, state.slot?.name === name ? state.slot.el : null)
    }
    sync()
    const ro = new ResizeObserver(sync)
    if (state.slot) ro.observe(state.slot.el)
    addEventListener("resize", sync)
    document.addEventListener("animationend", sync, true)
    document.addEventListener("transitionend", sync, true)
    const themed = new MutationObserver(() => {
      const l = look()
      for (const name of frames.keys()) send(name, { kiwi: MOD_PROTOCOL, type: "theme", ...l })
    })
    themed.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] })
    return () => {
      ro.disconnect()
      themed.disconnect()
      removeEventListener("resize", sync)
      document.removeEventListener("animationend", sync, true)
      document.removeEventListener("transitionend", sync, true)
    }
  })
  return <div ref={layer} className="mods-layer" style={{ display: "contents" }} />
}
