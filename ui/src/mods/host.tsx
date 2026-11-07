import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"

import { bridge } from "@kiwi/secrets/secrets.ts"
import type { KiwiBridge, ModView } from "../../../desktop/src/bridge.ts"
import type { MOD_MENU as MENU_EVENT, ModMenuAsk } from "~/chat/menus"
import { addCommands } from "~/commands/rebind"
import { bootFailed, bootGone, bootStarted } from "~/mods/boot"
import { hostMods, publishTabs } from "~/mods/bus"
import { carryCalm } from "~/mods/carry-calm"
import { channelsFor, modChannels } from "~/mods/channels"
import { asksRooms, grantsOf, mayPost, pacer, postBody, roomLink } from "~/mods/needs"
import { useIdleWait } from "~/mods/idle"
import { Rest } from "~/mods/rest"
import { useApp, type Go, type Panel } from "~/nav"
import { openOutside } from "~/kit/outside"
import { openLinksOutside } from "~/kit/outside-links"
import { announce, copyText } from "~/kit/toasts"
import { homeWaits, onHome } from "~/live/store"
import type { MOD_SIDES as SIDES_EVENT } from "~/shell/updates"
import {
  fromFrame,
  heeded,
  LOOK,
  MOD_PROTOCOL,
  POST_EVERY_MS,
  sameTarget,
  SIDE_HEIGHT,
  type ModChannel,
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
import { keep } from "~/mods/stored"
import { useStill } from "~/start/settle"

const FRAME_URL = "views://internal/mod-frame.html"
const STILL = "(prefers-reduced-motion: reduce)"
const LINK_GAP_MS = 500

const MOD_MENU: typeof MENU_EVENT = "kiwi-message-menu"
const MOD_SIDES: typeof SIDES_EVENT = "kiwi-mod-sides"

const ModSides = lazy(() => import("~/mods/side").then((m) => ({ default: m.ModSides })))
const ModAsk = lazy(() => import("~/mods/ask").then((m) => ({ default: m.ModAsk })))
const RailMods = lazy(() => import("~/shell/rail-mods"))

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
  channels: [] as ModChannel[],
  idles: new Map<string, { after: number; backdrop: "meadow" | null }>(),
  resting: null as { name: string; leaving: boolean } | null,
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
const putOff = new Set<string>()
const unbind = new Map<string, () => void>()
let version = 0

const keyOf = (name: string, surface: Surface): string => `${surface}:${name}`

const changed = (): void => {
  version++
  for (const l of listeners) l()
  publishTabs(
    modTabs(),
    state.mods.some((m) => m.state === "on" && m.needs.includes("github")),
    idleMod() !== null
  )
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export const useModsVersion = (): number => useSyncExternalStore(subscribe, () => version)

export const modsNow = (): ModView[] => state.mods

const askKey = (m: ModView): string => [m.name, ...m.needs, m.why ?? ""].join("\n")

export const askWaiting = (): ModView | undefined => state.mods.find((m) => m.state === "asks" && !putOff.has(askKey(m)))

export const askLater = (m: ModView): void => {
  putOff.add(askKey(m))
  changed()
}

export const askAgain = (name: string): void => {
  for (const k of putOff) if (k.startsWith(`${name}\n`)) putOff.delete(k)
  changed()
}

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

function idleMod(): { name: string; after: number; backdrop: "meadow" | null } | null {
  for (const { mod } of given("idle")) {
    const asked = state.idles.get(mod.name)
    if (asked && frames.get(keyOf(mod.name, "idle"))?.ready) return { name: mod.name, ...asked }
  }
  return null
}

function restNow(): boolean {
  const pick = idleMod()
  if (!pick || state.resting) return false
  state.resting = { name: pick.name, leaving: false }
  send(frames.get(keyOf(pick.name, "idle")), { kiwi: MOD_PROTOCOL, type: "rest", shown: true })
  changed()
  return true
}

function leaveRest(): void {
  if (!state.resting || state.resting.leaving) return
  state.resting = { ...state.resting, leaving: true }
  changed()
}

function restGone(): void {
  const was = state.resting
  if (!was) return
  state.resting = null
  send(frames.get(keyOf(was.name, "idle")), { kiwi: MOD_PROTOCOL, type: "rest", shown: false })
  changed()
}

function sendChannels(f: Frame): void {
  const list = channelsFor(modNamed(f.name), state.channels)
  if (list) send(f, { kiwi: MOD_PROTOCOL, type: "channels", list })
}

function sendRooms(f: Frame): void {
  const mod = modNamed(f.name)
  if (!mod || f.surface === "render" || f.surface === "idle" || !asksRooms(mod.needs).length) return
  send(f, { kiwi: MOD_PROTOCOL, type: "rooms", list: grantsOf(mod, (code) => state.channels.find((c) => c.code === code)?.title ?? null) })
}

const tooSoon = pacer(POST_EVERY_MS)

function setChannels(list: ModChannel[]): void {
  if (JSON.stringify(list) === JSON.stringify(state.channels)) return
  state.channels = list
  for (const f of frames.values()) sendChannels(f)
  for (const f of frames.values()) sendRooms(f)
  if (state.resting) changed()
}

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

export function look(): { theme: Record<string, string>; dark: boolean; still: boolean } {
  const css = getComputedStyle(document.documentElement)
  const theme: Record<string, string> = {}
  for (const t of LOOK) {
    const v = css.getPropertyValue(`--${t}`).trim()
    if (v) theme[`--${t}`] = v
  }
  const set = document.documentElement.dataset["theme"]
  const still = document.documentElement.dataset["motion"] === "reduced" || matchMedia(STILL).matches
  return { theme, dark: set ? set === "dark" : matchMedia("(prefers-color-scheme: dark)").matches, still }
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

const QUIET_MS = 1_000
const lastSaid = new Map<string, number>()

function often(name: string, kind: string): boolean {
  const key = `${kind}:${name}`
  const now = Date.now()
  if (now - (lastSaid.get(key) ?? 0) < QUIET_MS) return true
  lastSaid.set(key, now)
  return false
}

const focused = (f: Frame): boolean => document.hasFocus() && document.activeElement === f.el

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
      if (surface === "render") return
      send(f, { kiwi: MOD_PROTOCOL, type: "boot", name, surface, needs: mod?.needs ?? [], code: got.code, settings: got.settings ?? {}, ...look() })
      sendGithub(f)
      sendChannels(f)
      sendRooms(f)
      send(f, { kiwi: MOD_PROTOCOL, type: "showing", target: state.showing.get(name) ?? null })
      return
    }
    case "ready":
      bootGone(keyOf(name, surface))
      f.ready = true
      if (surface === "main") update(name, { failed: null })
      if (surface === "idle") changed()
      flush(f)
      return
    case "idle":
      state.idles.set(name, { after: m.after, backdrop: m.backdrop })
      changed()
      return
    case "leave":
      if (state.resting?.name === name) leaveRest()
      return
    case "channel":
      if (surface === "idle" && state.resting?.name !== name) return
      if (!state.channels.some((c) => c.code === m.code)) return
      app?.go({ to: "channel", code: m.code })
      if (surface === "idle") leaveRest()
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
      if (focused(f)) copyText(m.text, m.note ?? "Copied")
      return
    case "link":
      if (!focused(f) || Date.now() - f.linked < LINK_GAP_MS) return
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
    case "post": {
      const fail = (error: string) => send(f, { kiwi: MOD_PROTOCOL, type: "reply", id: m.id, ok: false, error })
      if (!mayPost(modNamed(name), m.code, m.room)) return fail(`${name} may not post in #${m.room} there: it isn't a room you picked for it`)
      const body = postBody(name, m.text)
      if (!body) return fail("there's nothing to post")
      const wait = tooSoon(name, Date.now())
      if (wait > 0) return fail(`${name} posts at most once every ${POST_EVERY_MS / 1000} seconds: try again in ${Math.ceil(wait / 1000)} s`)
      try {
        await roomLink(m.code).send(body, { kind: "msg", ...(m.room === "general" ? {} : { room: m.room }) })
        send(f, { kiwi: MOD_PROTOCOL, type: "reply", id: m.id, ok: true, value: null })
      } catch (err) {
        // The mod gets the reason; the person sees nothing, since they didn't write it.
        fail(err instanceof Error ? err.message : String(err))
      }
      return
    }
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
      return
    }
    case "storage": {
      let reply: ToFrame
      try {
        reply = { kiwi: MOD_PROTOCOL, type: "stored", id: m.id, ok: true, value: keep(localStorage, name, m.op, m.key, m.value) }
      } catch (err) {
        reply = { kiwi: MOD_PROTOCOL, type: "stored", id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      send(f, reply)
      return
    }
    case "toast":
      if (!often(name, "toast")) announce(`${name}: ${m.title}${m.message ? ` · ${m.message}` : ""}`, m.style === "failure" ? "error" : "info")
      return
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

function place(f: HTMLIFrameElement, el: HTMLElement | null, motion = ""): void {
  const r = el?.getBoundingClientRect()
  const css =
    !el || !r?.width || !r.height
      ? "position:fixed;left:0;top:0;width:0;height:0;border:0;visibility:hidden"
      : `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:0;z-index:${layerOf(el)};background:transparent${motion}`
  if (placed.get(f) === css) return
  placed.set(f, css)
  f.style.cssText = css
}

function surfacesOf(m: ModView): Surface[] {
  return ["main", ...(m.needs.includes("sidebar") ? (["sidebar"] as const) : []), ...(m.needs.includes("tab") ? (["tab"] as const) : []), ...(m.needs.includes("idle") ? (["idle"] as const) : [])]
}

const restMotion = (f: Frame): string =>
  f.surface !== "idle" || !state.resting ? "" : state.resting.leaving ? ";animation:rest-out 0.5s var(--ease) both;pointer-events:none" : ";animation:rest-in 2s var(--ease) both"

function startFrames(layer: HTMLElement): void {
  const want = new Map<string, { name: string; surface: Surface; hash: string; rev: string }>()
  for (const m of state.mods)
    if (m.state === "on" && m.hash) for (const surface of surfacesOf(m)) want.set(keyOf(m.name, surface), { name: m.name, surface, hash: m.hash, rev: String(m.settingsRev ?? 0) })
  for (const [key, f] of frames)
    if (want.get(key)?.hash !== f.el.dataset["hash"] || want.get(key)?.rev !== f.el.dataset["rev"]) {
      f.el.remove()
      frames.delete(key)
      bootGone(key)
      if (f.surface === "sidebar") update(f.name, { side: null })
      else if (f.surface === "tab") update(f.name, { tab: null })
      else if (f.surface === "idle") {
        state.idles.delete(f.name)
        if (state.resting?.name === f.name) state.resting = null
        changed()
      } else {
        state.running.delete(f.name)
        bindCommands(f.name, null)
        giveUp(f.name)
      }
    }
  for (const [key, { name, surface, hash, rev }] of want) {
    if (frames.has(key)) continue
    openLinksOutside()
    const el = document.createElement("iframe")
    el.setAttribute("sandbox", "allow-scripts")
    el.title = surface === "main" ? name : surface === "tab" ? `${name}'s tab` : surface === "idle" ? `${name} while you're away` : `${name} in the sidebar`
    if (surface === "idle") el.tabIndex = -1
    el.dataset["hash"] = hash
    el.dataset["rev"] = rev
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
  const { go, nav, app: current } = useApp()
  const still = useStill()
  const idle = idleMod()
  useIdleWait(idle?.after ?? 0, state.resting !== null, restNow)
  useEffect(() => setChannels(modChannels(current.channels, current.home)), [current.channels, current.home])
  useEffect(() => {
    const l = look()
    for (const f of frames.values()) send(f, { kiwi: MOD_PROTOCOL, type: "theme", ...l })
  }, [still])
  useEffect(() => {
    const scheme = matchMedia("(prefers-color-scheme: dark)")
    const resend = (): void => {
      const l = look()
      for (const f of frames.values()) send(f, { kiwi: MOD_PROTOCOL, type: "theme", ...l })
    }
    scheme.addEventListener("change", resend)
    return () => scheme.removeEventListener("change", resend)
  }, [])
  const resting = state.resting
  const restName = resting?.name ?? null
  const restSlot = useCallback(
    (el: HTMLElement | null) => {
      if (restName) showModIn(restName, el, "idle")
    },
    [restName]
  )
  const restFrame = useCallback(() => (restName ? (frames.get(keyOf(restName, "idle"))?.el ?? null) : null), [restName])
  const [sides, setSides] = useState(sidesAnchor)
  const [foot, setFoot] = useState(() => document.querySelector(".rail-foot"))
  useEffect(() => {
    const id = requestAnimationFrame(() => setFoot(document.querySelector(".rail-foot")))
    return () => cancelAnimationFrame(id)
  }, [])
  useModsVersion()
  useEffect(() => {
    app = { go, panel: null }
    hostMods({ github: setGithub, show: showIn, showTab: showTabIn, rest: restNow })
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
      const after = list.some((m) => m.name === "calm") ? carryCalm(localStorage) : null
      if (after) void b.setModSetting("calm", "after", after).catch(() => null)
      state.mods = list
      if (layer.current) startFrames(layer.current)
      for (const f of frames.values()) if (f.ready) sendRooms(f)
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
  }, [])
  useEffect(() => {
    const find = () => setSides(sidesAnchor())
    find()
    addEventListener(MOD_SIDES, find)
    return () => removeEventListener(MOD_SIDES, find)
  }, [])
  useEffect(() => {
    const sync = () => {
      for (const [key, f] of frames) place(f.el, slots.get(key) ?? null, restMotion(f))
    }
    sync()
    const ro = new ResizeObserver(sync)
    for (const el of slots.values()) ro.observe(el)
    addEventListener("resize", sync)
    document.addEventListener("animationend", sync, true)
    document.addEventListener("transitionend", sync, true)
    const watched = new MutationObserver((records) => {
      sync()
      if (!records.some((r) => r.attributeName === "style" || r.attributeName === "data-theme" || r.attributeName === "data-motion")) return
      const l = look()
      for (const f of frames.values()) send(f, { kiwi: MOD_PROTOCOL, type: "theme", ...l })
    })
    watched.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme", "data-motion", "data-side", "data-rail", "data-panel", "data-layout"] })
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
      {resting && (
        <Rest
          name={resting.name}
          leaving={resting.leaving}
          meadow={state.idles.get(resting.name)?.backdrop === "meadow"}
          alert={state.channels.some((c) => c.needs > 0)}
          still={still}
          slot={restSlot}
          frame={restFrame}
          leave={leaveRest}
          gone={restGone}
        />
      )}
      {foot &&
        createPortal(
          <Suspense fallback={null}>
            <RailMods />
          </Suspense>,
          foot
        )}
      {askWaiting() && (
        <Suspense fallback={null}>
          <ModAsk />
        </Suspense>
      )}
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
