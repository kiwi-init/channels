import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { CHANNELS_DARK, CHANNELS_OLED } from "~/theme/channels"
import { TOKENS } from "~/theme/derive"
import { activeTheme, allThemes, deletedTheme, isBuiltin, movedDark } from "~/theme/themes"

const css = readFileSync(join(import.meta.dir, "../styles/tokens.css"), "utf8")
const firstPaint = css.slice(css.indexOf(":root {"), css.indexOf(":root[data-theme"))
const token = (name: string): string | undefined => firstPaint.match(new RegExp(`\\n\\s*--${name}: ([^;]+);`))?.[1]

describe("OLED Black", () => {
  test("is pure black under the canvas, sidebar and panels", () => {
    expect(CHANNELS_OLED.colors.bg).toBe("#000000")
    expect(CHANNELS_OLED.colors["on-ink"]).toBe("#000000")
  })

  test("is what the page paints before any theme is applied", () => {
    for (const t of TOKENS) expect([t, token(t)]).toEqual([t, CHANNELS_OLED.colors[t]])
  })

  test("is the dark fallback, and Channels Dark stays in the picker", () => {
    const prefs = { theme: "dark" as const, darkTheme: "gone", lightTheme: "channels-light", customThemes: [] }
    expect(activeTheme(prefs, true).id).toBe(CHANNELS_OLED.id)
    expect(activeTheme({ ...prefs, darkTheme: CHANNELS_DARK.id }, true).id).toBe(CHANNELS_DARK.id)
    expect(isBuiltin(CHANNELS_OLED)).toBe(true)
    expect(isBuiltin(CHANNELS_DARK)).toBe(false)
    expect(allThemes([]).map((t) => t.id)).toContain(CHANNELS_DARK.id)
    expect(deletedTheme({ darkTheme: "mine", lightTheme: "channels-light", customThemes: [] }, "mine").darkTheme).toBe(CHANNELS_OLED.id)
  })

  test("moves a saved Channels Dark to OLED Black once, and leaves every other theme alone", () => {
    expect(movedDark(CHANNELS_DARK.id, false)).toBe(CHANNELS_OLED.id)
    expect(movedDark(CHANNELS_DARK.id, true)).toBe(CHANNELS_DARK.id)
    expect(movedDark("abyssal-trench", false)).toBe("abyssal-trench")
    expect(movedDark("mine-dusk", false)).toBe("mine-dusk")
  })
})
