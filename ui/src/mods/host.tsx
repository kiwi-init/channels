import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"

import { bridge } from "@kiwi/secrets/secrets.ts"
import type { KiwiBridge, ModView } from "../../../desktop/src/bridge.ts"
import type { MOD_MENU as MENU_EVENT, ModMenuAsk } from "~/chat/menus"
import { addCommands } from "~/commands/rebind"
import { bootFailed, bootGone, bootStarted } from "~/mods/boot"
import { hostMods, publishTabs } from "~/mods/bus"
import { useApp, type Go, type Panel } from "~/nav"
import { openOutside } from "~/kit/outside"
import { copyText } from "~/kit/toasts"
import { openLinksOutside } from "~/kit/outside-links"
import { announce } from "~/kit/toasts"
import { homeWaits, onHome } from "~/live/store"
import type { MOD_SIDES as SIDES_EVENT } from "~/shell/updates"
import {
  fromFrame,
  heeded,
  LOOK,
  MOD_PROTOCOL,
  sameTarget,
  SIDE_HEIGHT,
  type ModCommand,
  type ModGithub,
  type ModMessage,
  type ModOpen,
  type ModTarget,
  type ModTerminal,
  type PlacedTerminal,
  type Surface,
  type TerminalOp,
  type ToFrame,
} from "~/mods/protocol"

const FRAME_URL = "views://internal/mod-frame.html"
const LINK_GAP_MS = 500

const MOD_MENU: typeof MENU_EVENT = "kiwi-message-menu"
const MOD_SIDES: typeof SIDES_EVENT = "kiwi-mod-sides"

const ModSides = lazy(() => import("~/mods/side").then((m) => ({ default: m.ModSides })))

const sidesAnchor = (): HTMLElement | null => document.querySelector<HTMLElement>(".side .mod-sides")

export interface RunningMod {
  name: string
  title: string | null
  failed: string | null
  side: { title: string; height: number } | null
  tab: { title: string; shown: boolean; alert: string | null; hint: string | null } | null
  actions: ModCommand[]
  commands: string[]
}

interface Frame {
  name: string
  surface: Surface
  el: HTMLIFrameElement
  ready: boolean
  linked: number
}

const state = {
  mods: [] as ModView[],
  running: new Map<string, RunningMod>(),
  github: null as ModGithub | null,
  showing: new Map<string, ModTarget>(),
  pending: new Map<string, Waiting[]>(),
}
let app: { go: (g: Go) => void; panel: Panel | null } | null = null

interface Waiting {
  target: ModTarget
  url: string | null
}

function wait(key: string, target: ModTarget, url: string | null): void {
  state.pending.set(key, [...(state.pending.get(key) ?? []), { target, url }])
}

function giveUp(name: string): void {
  for (const key of [name, `tab:${name}`]) {
    for (const w of state.pending.get(key) ?? []) if (w.url) openOutside(w.url)
    state.pending.delete(key)
  }
}
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
  publishTabs(
    modTabs(),
    state.mods.some((m) => m.state === "on" && m.needs.includes("github"))
  )
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

export const modTabs = (): { name: string; title: string; alert: string | null; hint: string | null }[] =>
  given("tab").flatMap(({ mod, run }) => (run.tab?.shown ? [{ name: mod.name, title: run.tab.title, alert: run.tab.alert, hint: run.tab.hint }] : []))

const framesOf = (name: string): Frame[] => [...frames.values()].filter((f) => f.name === name)

function sendGithub(f: Frame): void {
  if (modNamed(f.name)?.needs.includes("github")) send(f, { kiwi: MOD_PROTOCOL, type: "github", data: state.github })
}

export function setGithub(data: ModGithub | null): void {
  if (JSON.stringify(data) === JSON.stringify(state.github)) return
  state.github = data
  for (const f of frames.values()) sendGithub(f)
}

function setShowing(name: string, target: ModTarget | null): void {
  if (sameTarget(state.showing.get(name) ?? null, target)) return
  if (target) state.showing.set(name, target)
  else state.showing.delete(name)
  for (const f of framesOf(name)) send(f, { kiwi: MOD_PROTOCOL, type: "showing", target })
}

const panelIs = (name: string): boolean => app?.panel?.kind === "mod" && app.panel.name === name

export function showIn(name: string, target: ModTarget, url: string | null = null): boolean {
  const mod = modNamed(name)
  if (!allows(mod, "panel") || state.running.get(name)?.failed || !app) return false
  if (!panelIs(name)) {
    app.go({ to: "panel", panel: { kind: "mod", name } })
    app.panel = { kind: "mod", name }
  }
  setShowing(name, target)
  const f = frames.get(keyOf(name, "main"))
  if (f?.ready) send(f, { kiwi: MOD_PROTOCOL, type: "show", target })
  else wait(name, target, url)
  return true
}

export function showTabIn(name: string, target: ModTarget): boolean {
  const mod = modNamed(name)
  if (!allows(mod, "tab") || state.running.get(name)?.failed || !app) return false
  app.go({ to: "tab", tab: `mod:${name}` })
  const f = frames.get(keyOf(name, "tab"))
  if (f?.ready) send(f, { kiwi: MOD_PROTOCOL, type: "show", target })
  else wait(`tab:${name}`, target, null)
  return true
}

function showFrom(name: string, target: ModTarget): void {
  if (panelIs(name) && sameTarget(state.showing.get(name) ?? null, target)) {
    app?.go({ to: "panel", panel: null })
    if (app) app.panel = null
    setShowing(name, null)
  } else showIn(name, target)
}

function openFor(to: ModOpen): void {
  if (to.kind === "task") app?.go({ to: "panel", panel: { kind: "task", task: to.id } })
  else if (to.kind === "settings") app?.go({ to: "modal", modal: { kind: "channel", tab: "github" } })
  else app?.go({ to: "tab", tab: "chat" })
}

function flush(f: Frame): void {
  const key = f.surface === "tab" ? `tab:${f.name}` : f.surface === "main" ? f.name : null
  if (!key) return
  for (const { target } of state.pending.get(key) ?? []) send(f, { kiwi: MOD_PROTOCOL, type: "show", target })
  state.pending.delete(key)
}

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

export function look(): { theme: Record<string, string>; dark: boolean } {
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
  if (patch.failed) giveUp(name)
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
      if (!got) {
        bootGone(keyOf(name, surface))
        update(name, { failed: "Its code couldn't be built." })
        return
      }
      send(f, { kiwi: MOD_PROTOCOL, type: "boot", name, surface, needs: mod?.needs ?? [], code: got.code, ...look() })
      sendGithub(f)
      send(f, { kiwi: MOD_PROTOCOL, type: "showing", target: state.showing.get(name) ?? null })
      return
    }
    case "ready":
      bootGone(keyOf(name, surface))
      f.ready = true
      if (surface === "main") update(name, { failed: null })
      flush(f)
      return
    case "tab":
      update(name, { tab: { title: m.title, shown: m.shown, alert: m.alert, hint: m.hint } })
      return
    case "open":
      openFor(m.to)
      return
    case "show":
      showFrom(name, m.target)
      return
    case "copy":
      copyText(m.text, m.note ?? "Copied")
      return
    case "link":
      if (Date.now() - f.linked < LINK_GAP_MS) return
      f.linked = Date.now()
      openOutside(m.url)
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
      return
    }
    case "terminal": {
      const reply: ToFrame = await terminalCall(b, name, m).then(
        (value) => ({ kiwi: MOD_PROTOCOL, type: "reply", id: m.id, ok: true, value }),
        (err: unknown) => ({ kiwi: MOD_PROTOCOL, type: "reply", id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) })
      )
      send(f, reply)
    }
  }
}

function withWaits(list: PlacedTerminal[]): ModTerminal[] {
  const rooms = new Map(homeWaits().map((h) => [h.room, h.waits]))
  return list.map((t) => ({ ...t, waits: rooms.get(t.room)?.[t.agent] ?? { asks: 0, tasks: [] } }))
}

async function focusOne(b: KiwiBridge, name: string, m: Extract<TerminalOp, { op: "focus" }>): Promise<void> {
  try {
    const seat = "seat" in m ? m.seat : (await b.modTerminals(name)).find((t) => t.room === m.room && t.agent === m.agent)?.id
    if (!seat) throw new Error("that agent isn't in a tmux pane or Rex block on this computer")
    await b.modTerminalFocus(name, seat)
  } catch (e) {
    announce(`${name}: ${e instanceof Error ? e.message : String(e)}`, "error")
    throw e
  }
}

async function terminalCall(b: KiwiBridge, name: string, m: TerminalOp): Promise<ModTerminal[] | null> {
  if (typeof b.modTerminals !== "function") throw new Error("this app is too old for a mod's terminals: update it")
  if (m.op === "list") return withWaits(await b.modTerminals(name))
  if (m.op === "focus") await focusOne(b, name, m)
  else await b.modTerminalMark(name, m.seat, m.mark)
  return null
}

let waitsSent = ""
let waitsTimer: ReturnType<typeof setTimeout> | null = null

async function sendTerminals(): Promise<void> {
  const b = bridge()
  if (!b || typeof b.modTerminals !== "function") return
  for (const { mod } of given("terminal")) {
    if (!mod.approved.includes("terminal")) continue
    const list = await b.modTerminals(mod.name).catch(() => null)
    if (list) send(frames.get(keyOf(mod.name, "main")), { kiwi: MOD_PROTOCOL, type: "terminals", list: withWaits(list) })
  }
}

function waitsMoved(): void {
  if (!given("terminal").length) return
  const now = JSON.stringify(homeWaits())
  if (now === waitsSent) return
  waitsSent = now
  if (waitsTimer) clearTimeout(waitsTimer)
  waitsTimer = setTimeout(() => {
    waitsTimer = null
    void sendTerminals()
  }, 300)
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
  return ["main", ...(m.needs.includes("sidebar") ? (["sidebar"] as const) : []), ...(m.needs.includes("tab") ? (["tab"] as const) : [])]
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
      else if (f.surface === "tab") update(f.name, { tab: null })
      else {
        state.running.delete(f.name)
        bindCommands(f.name, null)
        giveUp(f.name)
      }
    }
  for (const [key, { name, surface, hash }] of want) {
    if (frames.has(key)) continue
    openLinksOutside()
    const el = document.createElement("iframe")
    el.setAttribute("sandbox", "allow-scripts")
    el.title = surface === "main" ? name : surface === "tab" ? `${name}'s tab` : `${name} in the sidebar`
    el.dataset["hash"] = hash
    place(el, null)
    el.src = FRAME_URL
    frames.set(key, { name, surface, el, ready: false, linked: 0 })
    bootStarted(key, name, hash)
    if (!state.running.has(name)) state.running.set(name, { name, title: null, failed: null, side: null, tab: null, actions: [], commands: [] })
    layer.append(el)
  }
}

export function ModsLayer() {
  const layer = useRef<HTMLDivElement>(null)
  const { toast, go, nav } = useApp()
  const [sides, setSides] = useState(sidesAnchor)
  useModsVersion()
  useEffect(() => {
    app = { go, panel: null }
    hostMods({ github: setGithub, show: showIn, showTab: showTabIn })
    return () => {
      app = null
      hostMods(null)
    }
  }, [go])
  useEffect(() => {
    if (app) app.panel = nav.panel
    for (const name of [...state.showing.keys()]) if (!(nav.panel?.kind === "mod" && nav.panel.name === name)) setShowing(name, null)
  }, [nav.panel, go])
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
    const offHome = onHome(waitsMoved)
    return () => {
      live = false
      off()
      offHome()
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
