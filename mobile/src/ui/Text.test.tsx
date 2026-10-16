import { render, screen } from "@testing-library/react-native"
import * as RN from "react-native"
import { StyleSheet } from "react-native"

import { dark, light, type } from "../theme/tokens"
import { FAMILY, Text, type Variant } from "./Text"

const VARIANTS = Object.keys(type) as Variant[]

function styleOf(label: string) {
  return StyleSheet.flatten(screen.getByText(label).props.style)
}

afterEach(() => jest.restoreAllMocks())

describe("Text", () => {
  it.each(VARIANTS)("%s uses its type step and the ink color", async (variant) => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(<Text variant={variant}>{variant}</Text>)
    const style = styleOf(variant)
    expect(style.fontSize).toBe(type[variant].fontSize)
    expect(style.lineHeight).toBe(type[variant].lineHeight)
    expect(style.color).toBe(light.ink)
  })

  it("is body by default, and titles are semibold while body is regular", async () => {
    await render(
      <>
        <Text>plain</Text>
        <Text variant="title">heading</Text>
      </>
    )
    expect(styleOf("plain").fontSize).toBe(type.body.fontSize)
    expect(styleOf("plain").fontFamily).toBe(FAMILY.regular)
    expect(styleOf("heading").fontFamily).toBe(FAMILY.semibold)
  })

  it("takes its color from the scheme", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("dark")
    await render(<Text tone="ink3">quiet</Text>)
    expect(styleOf("quiet").color).toBe(dark.ink3)
  })

  it("can be told a weight, a tone, mono and tabular numbers, and keeps a caller's style last", async () => {
    await render(
      <Text weight="medium" tone="alert" mono numbers style={{ color: "#123456" }}>
        42
      </Text>
    )
    const style = styleOf("42")
    expect(style.fontFamily).toBe("Menlo")
    expect(style.fontVariant).toEqual(["tabular-nums"])
    expect(style.color).toBe("#123456")
  })

  it("names the three Inter weights it loads", () => {
    expect(Object.values(FAMILY)).toEqual(["Inter_400Regular", "Inter_500Medium", "Inter_600SemiBold"])
  })
})
