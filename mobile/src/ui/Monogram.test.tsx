import { PALETTE } from "@web/lib/characters"
import { render, screen } from "@testing-library/react-native"
import * as RN from "react-native"
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"

import { light } from "../theme/tokens"
import { Monogram } from "./Monogram"

interface Drawn {
  type?: string
  props?: Record<string, unknown>
  children?: Drawn[] | null
}

function all(node: Drawn | Drawn[] | null = screen.toJSON() as Drawn | null): Drawn[] {
  if (!node) return []
  if (Array.isArray(node)) return node.flatMap((one) => all(one))
  return [node, ...all(node.children ?? [])]
}

const robots = () => all().filter((n) => n.type === "RNSVGSvgView")
const styleOf = (node: { props?: Record<string, unknown> } | undefined) => (StyleSheet.flatten(node?.props?.style as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>

afterEach(() => jest.restoreAllMocks())

describe("Monogram", () => {
  it("draws a robot for an agent and initials for a person", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(
      <>
        <Monogram name="kiwi-sh" agent />
        <Monogram name="Jow" />
      </>
    )
    expect(robots()).toHaveLength(1)
    expect(screen.getByText("J")).toBeTruthy()
    expect(screen.queryByText("K")).toBeNull()
  })

  it("gives an agent the same robot for the same handle, whatever it is called", async () => {
    await render(
      <>
        <Monogram name="Coordinator" hue="kiwi-sh" agent />
        <Monogram name="Someone else" hue="kiwi-sh" agent size={40} />
      </>
    )
    const [first, second] = robots()
    expect(first?.children).toEqual(second?.children)
  })

  it("leaves a person with no pick quiet, and lets a pick set the color", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(
      <>
        <Monogram name="Jow" />
        <Monogram name="Ada" color="teal" />
      </>
    )
    const quiet = all().find((n) => styleOf(n).backgroundColor === light.wash2)
    const picked = all().find((n) => styleOf(n).backgroundColor === PALETTE.teal.fill)
    expect(quiet).toBeTruthy()
    expect(picked).toBeTruthy()
    expect(styleOf(screen.getByText("A")).color).toBe(PALETTE.teal.ink)
  })

  it("shows one or two letters, at a size the avatar sets", async () => {
    await render(
      <>
        <Monogram name="Jonatas Filho" />
        <Monogram name="Ada" />
      </>
    )
    expect(styleOf(screen.getByText("JF")).fontSize).toBe(Math.round(28 * 0.38))
    expect(styleOf(screen.getByText("A")).fontSize).toBe(Math.round(28 * 0.44))
  })

  it("marks an online member with the live dot and a canvas ring", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(<Monogram name="kiwi-sh" agent online size={40} />)
    const dot = all().find((n) => styleOf(n).backgroundColor === light.live)
    expect(dot).toBeTruthy()
    expect(styleOf(dot!)).toMatchObject({ borderColor: light.canvas, width: 10, height: 10, right: -2 })
  })

  it("rings a working agent in the in-progress blue", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(<Monogram name="kiwi-sh" agent working />)
    expect(all().some((n) => styleOf(n).borderColor === light.doing)).toBe(true)
  })
})
