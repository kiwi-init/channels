import { afterAll, describe, expect, test } from "bun:test"

import type { FolderThemesView } from "@kiwi/secrets/secrets.ts"

const KEY = "ui.themes.folder"
const stored = new Map<string, string>()
const before = { local: globalThis.localStorage }
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
  },
})

const dusk = { name: "Dusk", appearance: "dark" as const, base: { background: "#15131a", text: "#e8e2f0", accent: "#f0a86b" } }
stored.set(KEY, JSON.stringify([{ id: "file:dusk.json", ...dusk }]))

const pushes: ((v: FolderThemesView) => void)[] = []
let answer: FolderThemesView = { dir: "/home/ana/.kiwi/themes", themes: [], skipped: [] }
let asked = 0
const kiwi = {
  getSnapshot: () => ({ relayUrl: "", person: null, channels: [], computers: [], phones: [], pending: [], personalities: [] }),
  onStore: () => () => {},
  folderThemes: async () => (asked++, answer),
  onFolderThemes: (cb: (v: FolderThemesView) => void) => (pushes.push(cb), () => {}),
}
Object.assign(globalThis, { window: { kiwi } })
afterAll(() => {
  Reflect.deleteProperty(globalThis, "window")
  Object.assign(globalThis, { localStorage: before.local })
})

const { fileOf, folderThemes, startFolder } = await import("~/theme/folder")
const { activeTheme, movedTheme, wantsRex } = await import("~/theme/themes")

const settle = () => new Promise((r) => setTimeout(r, 0))

describe("themes from the folder", () => {
  test("the last folder themes are known before the app asks, so a folder theme paints on the first frame", () => {
    expect(folderThemes()).toEqual([{ id: "file:dusk.json", ...dusk }])
    const p = { theme: "dark" as const, darkTheme: "file:dusk.json", lightTheme: "channels-light", customThemes: folderThemes() }
    expect(activeTheme(p, true, []).name).toBe("Dusk")
  })

  test("the app's answer replaces them, each named file:<its file>, and is kept for the next start", async () => {
    answer = {
      dir: "/home/ana/.kiwi/themes",
      themes: [{ file: "moss.json", name: "Moss", appearance: "light", base: { background: "#f0f4ec", text: "#1d2a17", accent: "#5a8f3c" } }],
      skipped: [{ file: "bad.json", why: "isn't valid JSON" }],
    }
    startFolder()
    startFolder()
    await settle()
    expect(asked).toBe(1)
    expect(folderThemes().map((t) => [t.id, t.name])).toEqual([["file:moss.json", "Moss"]])
    expect(JSON.parse(stored.get(KEY) ?? "[]").map((t: { id: string }) => t.id)).toEqual(["file:moss.json"])
  })

  test("a change pushed by the watch shows at once, and an emptied folder leaves no cache behind", () => {
    pushes[0]?.({ dir: "/home/ana/.kiwi/themes", themes: [{ file: "dusk.json", ...dusk }], skipped: [] })
    expect(folderThemes().map((t) => t.id)).toEqual(["file:dusk.json"])
    pushes[0]?.({ dir: "/home/ana/.kiwi/themes", themes: [], skipped: [] })
    expect(folderThemes()).toEqual([])
    expect(stored.has(KEY)).toBe(false)
  })

  test("a theme the page can't use is dropped even if the app sent it", () => {
    pushes[0]?.({ dir: "/home/ana/.kiwi/themes", themes: [{ file: "x.json", name: "X", appearance: "dark", base: { background: "nope", text: "#ffffff", accent: "#ffffff" } }], skipped: [] })
    expect(folderThemes()).toEqual([])
  })

  test("a folder theme's id gives back its file, and only a folder theme's", () => {
    expect(fileOf("file:moss.json")).toBe("moss.json")
    expect(fileOf("mine-abc")).toBeNull()
  })

  test("picking a folder theme doesn't load the Rex themes, even before the folder answers", () => {
    expect(wantsRex({ darkTheme: "file:dusk.json", lightTheme: "channels-light", customThemes: [] })).toBe(false)
    expect(wantsRex({ darkTheme: "tokyo-night", lightTheme: "channels-light", customThemes: [] })).toBe(true)
  })

  test("moving a theme into the folder drops your copy and keeps it in use under its new id", () => {
    const mine = { id: "mine-dusk", ...dusk }
    expect(movedTheme({ darkTheme: "mine-dusk", lightTheme: "channels-light", customThemes: [mine] }, "mine-dusk", "file:dusk.json")).toEqual({
      customThemes: [],
      darkTheme: "file:dusk.json",
      lightTheme: "channels-light",
    })
    expect(movedTheme({ darkTheme: "channels-oled", lightTheme: "channels-light", customThemes: [mine] }, "mine-dusk", "file:dusk.json").darkTheme).toBe("channels-oled")
  })
})
