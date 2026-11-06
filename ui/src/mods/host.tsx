import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"

import { bridge } from "@kiwi/secrets/secrets.ts"
import type { ModView } from "../../../desktop/src/bridge.ts"
import type { MOD_MENU as MENU_EVENT, ModMenuAsk } from "~/chat/menus"
import { addCommands } from "~/commands/rebind"
import { bootFailed, bootGone, bootStarted } from "~/mods/boot"
import { useApp } from "~/nav"
import { openLinksOutside } from "~/kit/outside-links"
import type { MOD_SIDES as SIDES_EVENT } from "~/shell/updates"
import { fromFrame, heeded, LOOK, MOD_PROTOCOL, SIDE_HEIGHT, type ModCommand, type ModMessage, type Surface, type ToFrame } from "~/mods/protocol"

const FRAME_URL = "views://internal/mod-frame.html"

const MOD_MENU: typeof MENU_EVENT = "kiwi-message-menu"
const MOD_SIDES: typeof SIDES_EVENT = "kiwi-mod-sides"

const ModSides = lazy(() => import("~/mods/side").then((m) => ({ default: m.ModSides })))

const sidesAnchor = (): HTMLElement | null => document.querySelector<HTMLElement>(".side .mod-sides")

export interface RunningMod {
  name: string
  title: string | null
  failed: string | null
  side: { title: string; height: number } | null
  actions: ModCommand[]
  commands: string[]
}

interface Frame {
  name: string
  surface: Surface
  el: HTMLIFrameElement
}

const state = { mods: [] as ModView[], running: new Map<string, RunningMod>() }
const frames = new Map<string, Frame>()
const slots = new Map<string, HTMLElement>()
const listeners = new Set<() => void>()
const told = new Set<string>()
const unbind = new Map<string, () => void>()
let version = 0

const keyOf = (name: string, surface: Surface): string => `${surface}:${name}`

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

export function showMods(list: ModView[], running: RunningMod[] = []): void {
  state.mods = list
  for (const r of running) state.running.set(r.name, r)
  changed()
}

const allows = (mod: ModView | undefined, need: string): mod is ModView => !!mod && mod.state === "on" && mod.needs.includes(need)

const modNamed = (name: string): ModView | undefined => state.mods.find((m) => m.name === name)

function given(need: string): { mod: ModView; run: RunningMod }[] {
  return state.mods.flatMap((mod) => {
    const run = state.running.get(mod.name)
    return allows(mod, need) && run && !run.failed ? [{ mod, run }] : []
  })
}

export const modSides = (): { name: string; title: string; height: number }[] => given("sidebar").flatMap(({ mod, run }) => (run.side ? [{ name: mod.name, ...run.side }] : []))

function runAction(name: string, id: string, message: ModMessage): void {
  if (!allows(modNamed(name), "message-action") || !state.running.get(name)?.actions.some((a) => a.id === id)) return
  send(frames.get(keyOf(name, "main")), { kiwi: MOD_PROTOCOL, type: "action", id, message })
}

function messageMenu(e: Event): void {
  const { message, add } = (e as CustomEvent<ModMenuAsk>).detail
  for (const { mod, run } of given("message-action")) if (run.actions.length) add(run.actions.map((a) => ({ label: a.title, run: () => runAction(mod.name, a.id, message) })))
}

function bindCommands(name: string, list: ModCommand[] | null): void {
  unbind.get(name)?.()
  unbind.delete(name)
  if (list)
    unbind.set(
      name,
      addCommands(list.map((c) => ({ id: `${name}.${c.id}`, title: c.title, from: name, run: () => send(frames.get(keyOf(name, "main")), { kiwi: MOD_PROTOCOL, type: "command", id: c.id }) })))
    )
}

export function showModIn(name: string, el: HTMLElement | null, surface: Surface = "main"): void {
  const key = keyOf(name, surface)
  if (el) slots.set(key, el)
  else if (!slots.delete(key)) return
  changed()
}

function send(f: Frame | undefined, m: ToFrame): void {
  f?.el.contentWindow?.postMessage(m, "*")
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
  const next = { ...now, ...patch }
  if (JSON.stringify(next) === JSON.stringify(now)) return
  state.running.set(name, next)
  changed()
}

const sizes = new Map<string, number>()
let sizing = 0

function takeSizes(): void {
  sizing = 0
  let moved = false
  for (const [name, height] of sizes) {
    const now = state.running.get(name)
    if (!now?.side || now.side.height === height || !slots.get(keyOf(name, "sidebar"))?.getClientRects().length) continue
    state.running.set(name, { ...now, side: { ...now.side, height } })
    moved = true
  }
  sizes.clear()
  if (moved) changed()
}

async function onMessage(e: MessageEvent): Promise<void> {
  const f = [...frames.values()].find((x) => x.el.contentWindow === e.source)
  const m = f ? fromFrame(e.data) : null
  const b = bridge()
  if (!f || !m || !b) return
  const { name, surface } = f
  const mod = modNamed(name)
  if (!heeded(m.type, surface, mod)) return
  switch (m.type) {
    case "hello": {
      const got = await b.modBundle(name).catch(() => null)
      if (got) send(f, { kiwi: MOD_PROTOCOL, type: "boot", name, surface, needs: mod?.needs ?? [], code: got.code, ...look() })
      else {
        bootGone(keyOf(name, surface))
        update(name, { failed: "Its code couldn't be built." })
      }
      return
    }
    case "ready":
      bootGone(keyOf(name, surface))
      if (surface === "main") update(name, { failed: null })
      return
    case "error":
      bootFailed(keyOf(name, surface), m.message)
      update(name, { failed: m.message })
      return
    case "panel":
      update(name, { title: m.title })
      return
    case "commands":
      bindCommands(name, m.list)
      update(name, { commands: m.list.map((c) => c.title) })
      return
    case "actions":
      update(name, { actions: m.list })
      return
    case "sidebar":
      update(name, { side: { title: m.title, height: state.running.get(name)?.side?.height ?? SIDE_HEIGHT.min } })
      return
    case "size":
      sizes.set(name, m.height)
      sizing ||= requestAnimationFrame(takeSizes)
      return
    case "fetch": {
      const reply: ToFrame = await b.modFetch(name, { url: m.url, ...m.init }).then(
        (value) => ({ kiwi: MOD_PROTOCOL, type: "reply", id: m.id, ok: true, value }),
        (err: unknown) => ({ kiwi: MOD_PROTOCOL, type: "reply", id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) })
      )
      send(f, reply)
    }
  }
}

function layerOf(el: HTMLElement): number {
  let z = 0
  for (let at: HTMLElement | null = el; at; at = at.parentElement) {
    const n = Number.parseInt(getComputedStyle(at).zIndex, 10)
    if (Number.isFinite(n)) z = Math.max(z, n)
  }
  return z + 1
}

const placed = new WeakMap<HTMLIFrameElement, string>()

function place(f: HTMLIFrameElement, el: HTMLElement | null): void {
  const r = el?.getBoundingClientRect()
  const css =
    !el || !r?.width || !r.height
      ? "position:fixed;left:0;top:0;width:0;height:0;border:0;visibility:hidden"
      : `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:0;z-index:${layerOf(el)};background:transparent`
  if (placed.get(f) === css) return
  placed.set(f, css)
  f.style.cssText = css
}

function surfacesOf(m: ModView): Surface[] {
  return m.needs.includes("sidebar") ? ["main", "sidebar"] : ["main"]
}

function startFrames(layer: HTMLElement): void {
  const want = new Map<string, { name: string; surface: Surface; hash: string }>()
  for (const m of state.mods) if (m.state === "on" && m.hash) for (const surface of surfacesOf(m)) want.set(keyOf(m.name, surface), { name: m.name, surface, hash: m.hash })
  for (const [key, f] of frames)
    if (want.get(key)?.hash !== f.el.dataset["hash"]) {
      f.el.remove()
      frames.delete(key)
      bootGone(key)
      if (f.surface === "sidebar") update(f.name, { side: null })
      else {
        state.running.delete(f.name)
        bindCommands(f.name, null)
      }
    }
  for (const [key, { name, surface, hash }] of want) {
    if (frames.has(key)) continue
    openLinksOutside()
    const el = document.createElement("iframe")
    el.setAttribute("sandbox", "allow-scripts")
    el.title = surface === "main" ? name : `${name} in the sidebar`
    el.dataset["hash"] = hash
    place(el, null)
    el.src = FRAME_URL
    frames.set(key, { name, surface, el })
    bootStarted(key, name, hash)
    if (!state.running.has(name)) state.running.set(name, { name, title: null, failed: null, side: null, actions: [], commands: [] })
    layer.append(el)
  }
}

export function ModsLayer() {
  const layer = useRef<HTMLDivElement>(null)
  const { toast } = useApp()
  const [sides, setSides] = useState(sidesAnchor)
  useModsVersion()
  useEffect(() => {
    const b = bridge()
    if (!b || typeof b.mods !== "function") return
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
    addEventListener(MOD_MENU, messageMenu)
    return () => {
      live = false
      off()
      removeEventListener("message", message)
      removeEventListener(MOD_MENU, messageMenu)
    }
  }, [toast])
  useEffect(() => {
    const find = () => setSides(sidesAnchor())
    find()
    addEventListener(MOD_SIDES, find)
    return () => removeEventListener(MOD_SIDES, find)
  }, [])
  useEffect(() => {
    const sync = () => {
      for (const [key, f] of frames) place(f.el, slots.get(key) ?? null)
    }
    sync()
    const ro = new ResizeObserver(sync)
    for (const el of slots.values()) ro.observe(el)
    addEventListener("resize", sync)
    document.addEventListener("animationend", sync, true)
    document.addEventListener("transitionend", sync, true)
    const watched = new MutationObserver((records) => {
      sync()
      if (!records.some((r) => r.attributeName === "style" || r.attributeName === "data-theme")) return
      const l = look()
      for (const f of frames.values()) send(f, { kiwi: MOD_PROTOCOL, type: "theme", ...l })
    })
    watched.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme", "data-side", "data-rail", "data-panel", "data-layout"] })
    return () => {
      ro.disconnect()
      watched.disconnect()
      removeEventListener("resize", sync)
      document.removeEventListener("animationend", sync, true)
      document.removeEventListener("transitionend", sync, true)
    }
  })
  return (
    <>
      <div ref={layer} className="mods-layer" style={{ display: "contents" }} />
      {sides &&
        modSides().length > 0 &&
        createPortal(
          <Suspense fallback={null}>
            <ModSides />
          </Suspense>,
          sides
        )}
    </>
  )
}
