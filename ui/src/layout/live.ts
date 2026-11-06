import { useSyncExternalStore } from "react"

import { bridge, type LayoutArea, type LayoutsView, type LayoutView } from "@kiwi/secrets/secrets.ts"
import { BASE, LAYOUT_KEY, paint, painted, type Painted } from "~/shell/layout"
import { keepPanelWidth } from "~/shell/panel-width"

export interface Layouts {
  dir: string | null
  layouts: LayoutView[]
  skipped: LayoutsView["skipped"]
  chosen: string | null
}

let now: Layouts = { dir: null, layouts: [], skipped: [], chosen: painted()?.file ?? null }
const listeners = new Set<() => void>()

export function paintOf({ file, areas, widths }: LayoutView): Painted {
  const inner: LayoutArea[] = areas.filter((a) => a !== "rail")
  const at = (a: LayoutArea) => inner.indexOf(a)
  const [side, chat, panel] = [at("sidebar"), at("chat"), at("panel")]
  const cols = (bare: boolean, open: boolean) =>
    inner.flatMap((a) => (a === "chat" ? ["minmax(0, 1fr)"] : a === "sidebar" ? (bare ? [] : ["var(--side-w)"]) : open ? ["var(--panel-w)"] : [])).join(" ")
  const rail = areas[0] === "rail" ? null : areas.includes("rail") ? "right" : "none"
  const left = panel >= 0 && panel < chat
  const attrs: Record<string, string> = { layout: "on" }
  if (rail) attrs["rail"] = rail
  if (side < 0) attrs["side"] = "none"
  if (side !== 0) attrs["top"] = "bare"
  if (panel < 0) attrs["panel"] = "float"
  else if (left) attrs["panel"] = "left"
  const vars: Record<string, string> = {
    "--l-cols": cols(false, false),
    "--l-cols-p": cols(false, true),
    "--l-bare": cols(true, false),
    "--l-bare-p": cols(true, true),
    "--l-side-o": String(side + 1),
    "--l-main-o": String(chat + 1),
    "--l-panel-o": String(panel + 1),
  }
  if (widths.rail) vars["--l-rail"] = `${widths.rail}px`
  if (widths.sidebar) vars["--l-side"] = `${widths.sidebar}px`
  return {
    file,
    attrs,
    vars,
    shape: { rail: rail === "none" ? 0 : (widths.rail ?? BASE.rail), side: side < 0 ? 0 : (widths.sidebar ?? BASE.side), start: widths.panel ?? BASE.start, left },
  }
}

function keep(p: Painted | null): void {
  try {
    if (p) localStorage.setItem(LAYOUT_KEY, JSON.stringify(p))
    else localStorage.removeItem(LAYOUT_KEY)
  } catch {
    // Without storage the layout lasts until the app restarts, then the default paints.
  }
}

function apply(): void {
  if (!now.dir) return
  const layout = now.layouts.find((l) => l.file === now.chosen)
  const next = layout ? paintOf(layout) : now.chosen ? { file: now.chosen, attrs: {}, vars: {}, shape: BASE } : null
  const was = painted()
  if (JSON.stringify(was) === JSON.stringify(next)) return
  const start = next?.shape.start ?? BASE.start
  if ((was?.shape.start ?? BASE.start) !== start) keepPanelWidth(start)
  paint(next)
  keep(next)
}

function set(next: Layouts): void {
  now = next
  apply()
  for (const l of listeners) l()
}

export const showLayouts = (view: LayoutsView): void => set({ ...now, dir: view.dir, layouts: view.layouts, skipped: view.skipped })

export const pickLayout = (file: string | null): void => set({ ...now, chosen: file })

let started = false

export function startLayouts(): void {
  const b = bridge()
  if (started || typeof b?.layouts !== "function") return
  started = true
  b.onLayouts(showLayouts)
  void b.layouts().then(showLayouts, () => {})
}

export const useLayouts = (): Layouts =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => now
  )
