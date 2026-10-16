import { fireEvent, render, screen } from "@testing-library/react-native"
import * as RN from "react-native"
import { StyleSheet, Text as RNText } from "react-native"

import { dark, light } from "../theme/tokens"
import { Button } from "./Button"
import { IconButton } from "./IconButton"
import { Pill } from "./Pill"

afterEach(() => jest.restoreAllMocks())

function flat(node: { props: { style?: unknown } }) {
  const s = node.props.style
  return StyleSheet.flatten(typeof s === "function" ? s({ pressed: false }) : s)
}

describe("Button", () => {
  it("shows its title and calls onPress", async () => {
    const onPress = jest.fn()
    await render(<Button title="Send" onPress={onPress} />)
    await fireEvent.press(screen.getByRole("button", { name: "Send" }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("does not call onPress when disabled, and says so to screen readers", async () => {
    const onPress = jest.fn()
    await render(<Button title="Send" disabled onPress={onPress} />)
    const button = screen.getByRole("button", { name: "Send" })
    await fireEvent.press(button)
    expect(onPress).not.toHaveBeenCalled()
    expect(button.props.accessibilityState).toMatchObject({ disabled: true })
  })

  it("is accent-filled when primary, washed when secondary, and bare when ghost or danger", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(
      <>
        <Button title="a" />
        <Button title="b" variant="secondary" />
        <Button title="c" variant="ghost" />
        <Button title="d" variant="danger" />
      </>
    )
    expect(flat(screen.getByRole("button", { name: "a" })).backgroundColor).toBe(light.accent)
    expect(flat(screen.getByRole("button", { name: "b" })).backgroundColor).toBe(light.wash2)
    expect(flat(screen.getByRole("button", { name: "c" })).backgroundColor).toBe("transparent")
    expect(flat(screen.getByText("d")).color).toBe(light.alert)
  })

  it("grows with its size", async () => {
    await render(
      <>
        <Button title="s" size="sm" />
        <Button title="m" size="md" />
        <Button title="l" size="lg" />
      </>
    )
    const heights = ["s", "m", "l"].map((t) => flat(screen.getByRole("button", { name: t })).height)
    expect(heights).toEqual([32, 40, 48])
  })

  it("follows the dark scheme", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("dark")
    await render(<Button title="Go" />)
    expect(flat(screen.getByRole("button", { name: "Go" })).backgroundColor).toBe(dark.accent)
  })
})

describe("IconButton", () => {
  it("is labelled for screen readers and calls onPress", async () => {
    const onPress = jest.fn()
    await render(
      <IconButton label="Attach" onPress={onPress}>
        <RNText>+</RNText>
      </IconButton>
    )
    await fireEvent.press(screen.getByRole("button", { name: "Attach" }))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("hands its icon the color for its state", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    const seen: string[] = []
    await render(
      <>
        <IconButton label="quiet">
          {(color) => {
            seen.push(color)
            return <RNText>q</RNText>
          }}
        </IconButton>
        <IconButton label="on" active>
          {(color) => {
            seen.push(color)
            return <RNText>o</RNText>
          }}
        </IconButton>
      </>
    )
    expect(seen).toEqual([light.ink2, light.ink])
    expect(screen.getByRole("button", { name: "on" }).props.accessibilityState).toMatchObject({ selected: true })
  })

  it("is round when asked and keeps a 44-point touch target", async () => {
    await render(
      <IconButton label="Close" round size={36}>
        <RNText>x</RNText>
      </IconButton>
    )
    const button = screen.getByRole("button", { name: "Close" })
    expect(flat(button).borderRadius).toBe(18)
    expect(button.props.hitSlop).toBe(4)
  })
})

describe("Pill", () => {
  it("shows its label in the tone's colors", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(<Pill label="Decision for you" tone="decide" />)
    expect(screen.getByText("Decision for you")).toBeTruthy()
    expect(flat(screen.getByText("Decision for you")).color).toBe(light.decide)
  })
})
