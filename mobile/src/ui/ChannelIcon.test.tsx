import { PALETTE } from "@web/lib/characters"
import { render, screen } from "@testing-library/react-native"
import * as RN from "react-native"
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"

import { ChannelIconTile, letterOf } from "./ChannelIcon"
import { hueOf } from "./hue"

interface Drawn {
  type?: string
  props?: Record<string, unknown>
  children?: Drawn[] | null
}

function drawn(): Drawn[] {
  const root = screen.toJSON() as Drawn | Drawn[] | null
  if (!root) return []
  if (Array.isArray(root)) return root
  return root.type === "" ? (root.children ?? []) : [root]
}

function styleOf(node: { props?: Record<string, unknown> } | undefined): Record<string, unknown> {
  return (StyleSheet.flatten(node?.props?.style as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>
}

function fillOf(node: Drawn | undefined): unknown {
  return styleOf(node).backgroundColor
}

afterEach(() => jest.restoreAllMocks())

describe("ChannelIcon", () => {
  it("gives the same title the same colour, from the title's hue", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(
      <>
        <ChannelIconTile icon={null} title="channels-dev" size={32} />
        <ChannelIconTile icon={null} title="channels-dev" size={40} />
        <ChannelIconTile icon={null} title="onemouse" size={32} />
      </>
    )
    const [dev, devAgain, other] = drawn()
    expect(fillOf(dev)).toBe(fillOf(devAgain))
    expect(fillOf(dev)).toBe(PALETTE[hueOf("channels-dev")].fill)
    expect(fillOf(other)).not.toBe(fillOf(dev))
  })

  it("wears the title's first letter, round, at the size asked for", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(<ChannelIconTile icon={null} title="  onemouse" size={64} />)
    const [tile] = drawn()
    expect(screen.getByText("O")).toBeTruthy()
    expect(tile?.props?.style).toEqual(expect.arrayContaining([expect.objectContaining({ width: 64, height: 64, borderRadius: 32 })]))
    expect(letterOf("")).toBe("?")
  })

  it("draws an emoji or an image when the channel has one", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(
      <>
        <ChannelIconTile icon={{ kind: "emoji", emoji: "🦉" }} title="owl" size={28} />
        <ChannelIconTile icon={{ kind: "image", mime: "image/png", data: "AAAA" }} title="owl" size={28} />
      </>
    )
    const [emoji, image] = drawn()
    expect(screen.getByText("🦉")).toBeTruthy()
    expect(image?.type).toBe("Image")
    expect(((image?.props?.source ?? { uri: "" }) as { uri: string }).uri).toBe("data:image/png;base64,AAAA")
    expect(fillOf(emoji)).toBe(styleOf(image).backgroundColor)
    expect(fillOf(emoji)).not.toBe(PALETTE[hueOf("owl")].fill)
  })
})
