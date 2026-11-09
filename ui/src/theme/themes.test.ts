import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { CHANNELS_DARK, CHANNELS_OLED, CINDER_PEAK } from "~/theme/channels"
import { TOKENS } from "~/theme/derive"
import { loadRex } from "~/theme/rex"
import { REX_THEMES } from "~/theme/rex-themes"
import { activeTheme, allThemes, deletedTheme, isBuiltin, movedDark, wantsRex } from "~/theme/themes"

const css = readFileSync(join(import.meta.dir, "../styles/tokens.css"), "utf8")
const firstPaint = css.slice(css.indexOf(":root {"), css.indexOf(":root[data-theme"))
const token = (name: string): string | undefined => firstPaint.match(new RegExp(`\\n\\s*--${name}: ([^;]+);`))?.[1]

describe("Channels Dark", () => {
  test("is what the page paints before any theme is applied", () => {
    for (const t of TOKENS) expect([t, token(t)]).toEqual([t, CHANNELS_DARK.colors[t]])
  })

  test("is the dark fallback and built in, first in the picker, and no Rex theme", () => {
    const prefs = { theme: "dark" as const, darkTheme: "gone", lightTheme: "channels-light", customThemes: [] }
    expect(activeTheme(prefs, true).id).toBe(CHANNELS_DARK.id)
    expect(isBuiltin(CHANNELS_DARK)).toBe(true)
    expect(wantsRex({ ...prefs, darkTheme: CHANNELS_DARK.id })).toBe(false)
    expect(allThemes([], REX_THEMES).filter((t) => t.id === CHANNELS_DARK.id)).toHaveLength(1)
    expect(allThemes([])[0]?.id).toBe(CHANNELS_DARK.id)
    expect(deletedTheme({ darkTheme: "mine", lightTheme: "channels-light", customThemes: [] }, "mine").darkTheme).toBe(CHANNELS_DARK.id)
  })

  test("takes the old default Cinder Peak once, through the earlier OLED and Cinder moves; every other theme stays", () => {
    const fresh = { oled: false, cinder: false, channels: false }
    expect(movedDark(CINDER_PEAK.id, { oled: true, cinder: true, channels: false })).toBe(CHANNELS_DARK.id)
    expect(movedDark(CINDER_PEAK.id, { oled: true, cinder: true, channels: true })).toBe(CINDER_PEAK.id)
    expect(movedDark(CHANNELS_OLED.id, { oled: true, cinder: false, channels: false })).toBe(CHANNELS_DARK.id)
    expect(movedDark(CHANNELS_OLED.id, { oled: true, cinder: true, channels: true })).toBe(CHANNELS_OLED.id)
    expect(movedDark(CHANNELS_DARK.id, fresh)).toBe(CHANNELS_DARK.id)
    expect(movedDark("abyssal-trench", fresh)).toBe("abyssal-trench")
    expect(movedDark("mine-dusk", fresh)).toBe("mine-dusk")
  })
})

describe("OLED Black and Cinder Peak", () => {
  test("OLED Black stays pure black under the canvas, sidebar and panels", () => {
    expect(CHANNELS_OLED.colors.bg).toBe("#000000")
    expect(CHANNELS_OLED.colors["on-ink"]).toBe("#000000")
  })

  test("stay in the picker, resolve without the Rex themes, and paint their own colours", () => {
    const prefs = { theme: "dark" as const, darkTheme: CHANNELS_OLED.id, lightTheme: "channels-light", customThemes: [] }
    expect(activeTheme(prefs, true, []).id).toBe(CHANNELS_OLED.id)
    expect(activeTheme({ ...prefs, darkTheme: CINDER_PEAK.id }, true, []).id).toBe(CINDER_PEAK.id)
    expect(wantsRex(prefs)).toBe(false)
    expect(wantsRex({ ...prefs, darkTheme: CINDER_PEAK.id })).toBe(false)
    expect([isBuiltin(CHANNELS_OLED), isBuiltin(CINDER_PEAK)]).toEqual([false, false])
    expect(allThemes([]).map((t) => t.id)).toEqual(expect.arrayContaining([CHANNELS_OLED.id, CINDER_PEAK.id]))
  })
})

describe("Rex themes", () => {
  test("load only for a saved Rex theme, and resolve once loaded", async () => {
    const prefs = { theme: "dark" as const, darkTheme: "abyssal-trench", lightTheme: "channels-light", customThemes: [] }
    expect(wantsRex({ ...prefs, darkTheme: "mine", customThemes: [{ id: "mine", name: "Mine", appearance: "dark", base: { background: "#000000", text: "#ffffff", accent: "#ff0000" } }] })).toBe(false)
    expect(wantsRex(prefs)).toBe(true)
    await loadRex()
    expect(activeTheme(prefs, true).id).toBe("abyssal-trench")
    expect(allThemes([]).map((t) => t.id)).toContain("abyssal-trench")
  })
})
