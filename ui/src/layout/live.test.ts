import { afterAll, describe, expect, test } from "bun:test"

import type { LayoutsView, LayoutView } from "@kiwi/secrets/secrets.ts"

const dataset: Record<string, string> = { theme: "dark" }
const vars = new Map<string, string>()
const store = new Map<string, string>()
let pushed: ((view: LayoutsView) => void) | null = null
let folder: LayoutsView = { dir: "/home/ana/.kiwi/layouts", layouts: [], skipped: [] }
const kiwi = {
  getSnapshot: () => ({ relayUrl: "", person: null, channels: [], computers: [], phones: [], pending: [], personalities: [] }),
  onStore: () => () => {},
  layouts: async () => folder,
  onLayouts: (cb: (view: LayoutsView) => void) => ((pushed = cb), () => {}),
}
Object.assign(globalThis, {
  window: { kiwi },
  document: { documentElement: { dataset, style: { setProperty: (k: string, v: string) => vars.set(k, v), removeProperty: (k: string) => vars.delete(k) } } },
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) },
})
afterAll(() => {
  for (const k of ["window", "document", "localStorage"]) Reflect.deleteProperty(globalThis, k)
})

store.set("ui.layout", JSON.stringify({ file: "old.json", attrs: { layout: "on", rail: "right" }, vars: { "--l-cols": "minmax(0, 1fr)" }, shape: { rail: 64, side: 248, start: 400, left: false } }))
const { BASE, layoutShape, paintCached, painted } = await import("~/shell/layout")
paintCached()
const { paintOf, pickLayout, showLayouts, startLayouts } = await import("~/layout/live")
const { panelRoom } = await import("~/shell/panel-width")

const layout = (file: string, areas: LayoutView["areas"], widths: LayoutView["widths"] = {}): LayoutView => ({ file, name: file, areas, widths })
const MAIN = layout("main.json", ["rail", "sidebar", "chat", "panel"])
const FOCUS = layout("focus.json", ["chat", "panel"], { panel: 520 })
const MIRROR = layout("mirror.json", ["panel", "chat", "sidebar", "rail"], { sidebar: 280, rail: 72 })
const OVERLAY = layout("overlay.json", ["rail", "sidebar", "chat"])

describe("a layout paints", () => {
  test("main's order as main's grid, with nothing moved", () => {
    expect(paintOf(MAIN)).toEqual({
      file: "main.json",
      attrs: { layout: "on" },
      vars: {
        "--l-cols": "var(--side-w) minmax(0, 1fr)",
        "--l-cols-p": "var(--side-w) minmax(0, 1fr) var(--panel-w)",
        "--l-bare": "minmax(0, 1fr)",
        "--l-bare-p": "minmax(0, 1fr) var(--panel-w)",
        "--l-side-o": "1",
        "--l-main-o": "2",
        "--l-panel-o": "3",
      },
      shape: BASE,
    })
  })

  test("a mirrored order: the rail on the right, the panel left of the chat, the sidebar's header bare", () => {
    const p = paintOf(MIRROR)
    expect(p.attrs).toEqual({ layout: "on", rail: "right", top: "bare", panel: "left" })
    expect(p.vars["--l-cols-p"]).toBe("var(--panel-w) minmax(0, 1fr) var(--side-w)")
    expect(p.vars["--l-bare"]).toBe("minmax(0, 1fr)")
    expect([p.vars["--l-panel-o"], p.vars["--l-main-o"], p.vars["--l-side-o"]]).toEqual(["1", "2", "3"])
    expect(p.vars["--l-side"]).toBe("280px")
    expect(p.vars["--l-rail"]).toBe("72px")
    expect(p.shape).toEqual({ rail: 72, side: 280, start: 400, left: true })
  })

  test("areas left out: no rail and no sidebar take no room; a missing panel floats over the chat", () => {
    const focus = paintOf(FOCUS)
    expect(focus.attrs).toEqual({ layout: "on", rail: "none", side: "none", top: "bare" })
    expect(focus.vars["--l-cols-p"]).toBe("minmax(0, 1fr) var(--panel-w)")
    expect(focus.shape).toEqual({ rail: 0, side: 0, start: 520, left: false })
    const overlay = paintOf(OVERLAY)
    expect(overlay.attrs).toEqual({ layout: "on", panel: "float" })
    expect(overlay.vars["--l-cols-p"]).toBe("var(--side-w) minmax(0, 1fr)")
  })

  test("the panel's room counts the layout's rail and sidebar", () => {
    expect(panelRoom(700, 1300, false)).toBe(1300 - 64 - 248 - 420)
    expect(panelRoom(700, 1300, false, paintOf(FOCUS).shape)).toBe(700)
    expect(panelRoom(700, 1300, false, paintOf(MIRROR).shape)).toBe(1300 - 72 - 280 - 420)
  })
})

describe("the picked layout", () => {
  test("paints from the cache before the folder answers, then follows the folder, and Default clears it", async () => {
    expect(dataset).toEqual({ theme: "dark", layout: "on", rail: "right" })
    expect(vars.get("--l-cols")).toBe("minmax(0, 1fr)")

    showLayouts({ dir: folder.dir, layouts: [MAIN, FOCUS], skipped: [] })
    expect(dataset).toEqual({ theme: "dark" })
    expect(vars.size).toBe(0)
    expect(JSON.parse(store.get("ui.layout") ?? "null")?.file).toBe("old.json")

    pickLayout("focus.json")
    expect(dataset).toEqual({ theme: "dark", layout: "on", rail: "none", side: "none", top: "bare" })
    expect(layoutShape().start).toBe(520)
    expect(store.get("channels.panel.width")).toBe("520")
    expect(JSON.parse(store.get("ui.layout") ?? "null")).toEqual(paintOf(FOCUS))

    store.set("channels.panel.width", "610")
    showLayouts({ dir: folder.dir, layouts: [MAIN, FOCUS], skipped: [] })
    expect(store.get("channels.panel.width")).toBe("610")

    pickLayout(null)
    expect(dataset).toEqual({ theme: "dark" })
    expect(vars.size).toBe(0)
    expect(painted()).toBeNull()
    expect(store.has("ui.layout")).toBe(false)
    expect(store.get("channels.panel.width")).toBe("400")
  })

  test("a saved file repaints through the bridge's push", async () => {
    folder = { dir: folder.dir, layouts: [MIRROR], skipped: [] }
    pickLayout("mirror.json")
    startLayouts()
    await Bun.sleep(0)
    expect(dataset["rail"]).toBe("right")
    pushed?.({ dir: folder.dir, layouts: [{ ...MIRROR, areas: ["rail", "chat", "sidebar"] }], skipped: [] })
    expect(dataset).toEqual({ theme: "dark", layout: "on", top: "bare", panel: "float" })
    pickLayout(null)
  })
})
