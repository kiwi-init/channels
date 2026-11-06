import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { CHANNELS_DARK, CHANNELS_OLED, CINDER_PEAK } from "~/theme/channels"
import { TOKENS } from "~/theme/derive"
import { loadRex } from "~/theme/rex"
import { activeTheme, allThemes, deletedTheme, isBuiltin, movedDark, wantsRex } from "~/theme/themes"

const css = readFileSync(join(import.meta.dir, "../styles/tokens.css"), "utf8")
const firstPaint = css.slice(css.indexOf(":root {"), css.indexOf(":root[data-theme"))
const token = (name: string): string | undefined => firstPaint.match(new RegExp(`\\n\\s*--${name}: ([^;]+);`))?.[1]

describe("Cinder Peak", () => {
  test("is what the page paints before any theme is applied", () => {
    for (const t of TOKENS) expect([t, token(t)]).toEqual([t, CINDER_PEAK.colors[t]])
  })

  test("is the dark fallback, and OLED Black and Channels Dark stay in the picker", () => {
    const prefs = { theme: "dark" as const, darkTheme: "gone", lightTheme: "channels-light", customThemes: [] }
    expect(activeTheme(prefs, true).id).toBe(CINDER_PEAK.id)
    expect(activeTheme({ ...prefs, darkTheme: CHANNELS_OLED.id }, true).id).toBe(CHANNELS_OLED.id)
    expect(activeTheme({ ...prefs, darkTheme: CHANNELS_DARK.id }, true).id).toBe(CHANNELS_DARK.id)
    expect(isBuiltin(CINDER_PEAK)).toBe(true)
    expect(isBuiltin(CHANNELS_OLED)).toBe(false)
    expect(allThemes([]).map((t) => t.id)).toEqual(expect.arrayContaining([CINDER_PEAK.id, CHANNELS_OLED.id, CHANNELS_DARK.id]))
    expect(deletedTheme({ darkTheme: "mine", lightTheme: "channels-light", customThemes: [] }, "mine").darkTheme).toBe(CINDER_PEAK.id)
  })

  test("moves a saved OLED Black or Channels Dark to Cinder Peak once, and leaves every other theme alone", () => {
    expect(movedDark(CHANNELS_OLED.id, false)).toBe(CINDER_PEAK.id)
    expect(movedDark(CHANNELS_DARK.id, false)).toBe(CINDER_PEAK.id)
    expect(movedDark(CHANNELS_OLED.id, true)).toBe(CHANNELS_OLED.id)
    expect(movedDark("abyssal-trench", false)).toBe("abyssal-trench")
    expect(movedDark("mine-dusk", false)).toBe("mine-dusk")
  })
})

describe("OLED Black", () => {
  test("is pure black under the canvas, sidebar and panels", () => {
    expect(CHANNELS_OLED.colors.bg).toBe("#000000")
    expect(CHANNELS_OLED.colors["on-ink"]).toBe("#000000")
  })
})

describe("Rex themes", () => {
  test("load only for a saved Rex theme, and resolve once loaded", async () => {
    const prefs = { theme: "dark" as const, darkTheme: "abyssal-trench", lightTheme: "channels-light", customThemes: [] }
    expect(wantsRex({ ...prefs, darkTheme: CHANNELS_OLED.id })).toBe(false)
    expect(wantsRex({ ...prefs, darkTheme: CINDER_PEAK.id })).toBe(false)
    expect(wantsRex({ ...prefs, darkTheme: "mine", customThemes: [{ id: "mine", name: "Mine", appearance: "dark", base: { background: "#000000", text: "#ffffff", accent: "#ff0000" } }] })).toBe(false)
    expect(wantsRex(prefs)).toBe(true)
    await loadRex()
    expect(activeTheme(prefs, true).id).toBe("abyssal-trench")
    expect(allThemes([]).map((t) => t.id)).toContain("abyssal-trench")
    expect(allThemes([]).filter((t) => t.id === CINDER_PEAK.id)).toHaveLength(1)
  })
})
