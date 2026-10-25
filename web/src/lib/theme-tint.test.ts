import { describe, expect, test } from "bun:test"

import { TINTS, tintColors, tintSwatch } from "./theme"

describe("Tint, as Interlinked has it (T1278)", () => {
  test("offers ink, violet, moss, amber, pine and Accent Color, in that order", () => {
    expect(TINTS.map((t) => t.label)).toEqual(["Ink", "Violet", "Moss", "Amber", "Pine", "Accent Color"])
  })

  test("each fixed tint is its base color's hue at Interlinked's 46% lightness, with saturation held to 75%", () => {
    expect(tintColors("pine", null).accent).toBe("hsl(165.7 75% 46%)")
    expect(tintColors("violet", null).accent).toBe("hsl(280 14.3% 46%)")
    expect(tintColors("moss", null).accent).toBe("hsl(144 13.5% 46%)")
    expect(tintColors("amber", null).accent).toBe("hsl(33.3 24.3% 46%)")
    expect(tintColors("ink", null).accent).toBe("hsl(240 10% 46%)")
  })

  test("text and links take a lighter step of the same hue, so they read on the dark canvas", () => {
    expect(tintColors("pine", null).text).toBe("hsl(165.7 75% 72%)")
    expect(tintColors("pine", null).wash).toBe("hsl(165.7 75% 46% / 0.18)")
    expect(tintColors("pine", null).ring).toBe("hsl(165.7 75% 46% / 0.6)")
  })

  test("ink keeps the shell clear, the other fixed tints wash it", () => {
    expect(tintColors("ink", null).glass).toBeNull()
    for (const t of ["violet", "moss", "amber", "pine"] as const) expect(tintColors(t, null).glass).toBe(tintColors(t, null).accent)
  })

  test("Accent Color is the system's color as it is, and falls back to ink where the host gives none or garbage", () => {
    expect(tintColors("accent", "#0a84ff")).toEqual({ accent: "#0a84ff", text: "#0a84ff", wash: "rgb(10 132 255 / 0.18)", ring: "rgb(10 132 255 / 0.6)", glass: "#0a84ff" })
    for (const bad of [null, "", "blue", "#0A84FF", "#0a84f", "#0a84ff; color: red"]) {
      expect(tintColors("accent", bad)).toEqual({ ...tintColors("ink", null), glass: null })
    }
  })

  test("the swatches show each tint's color, ink a neutral grey", () => {
    expect(tintSwatch("ink", null)).toBe("#8e8e93")
    expect(tintSwatch("accent", "#ff2d55")).toBe("#ff2d55")
    expect(tintSwatch("moss", null)).toBe(tintColors("moss", null).accent)
  })
})
