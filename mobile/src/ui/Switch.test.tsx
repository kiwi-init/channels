import { fireEvent, render, screen } from "@testing-library/react-native"
import * as RN from "react-native"
import { StyleSheet } from "react-native"

import { light } from "../theme/tokens"
import { Switch } from "./Switch"

afterEach(() => jest.restoreAllMocks())

function flat(node: { props: { style?: unknown } }) {
  const s = node.props.style
  return StyleSheet.flatten(typeof s === "function" ? s({ pressed: false }) : s)
}

const knobOf = (name: string) => flat(screen.getByRole("switch", { name }).children[0] as unknown as { props: { style?: unknown } })

describe("Switch", () => {
  it("asks for the other value when pressed", async () => {
    const onValueChange = jest.fn()
    await render(
      <>
        <Switch label="off" value={false} onValueChange={onValueChange} />
        <Switch label="on" value onValueChange={onValueChange} />
      </>
    )
    await fireEvent.press(screen.getByRole("switch", { name: "off" }))
    expect(onValueChange).toHaveBeenCalledWith(true)
    await fireEvent.press(screen.getByRole("switch", { name: "on" }))
    expect(onValueChange).toHaveBeenLastCalledWith(false)
  })

  it("tells screen readers whether it's on", async () => {
    await render(
      <>
        <Switch label="off" value={false} onValueChange={() => {}} />
        <Switch label="on" value onValueChange={() => {}} />
      </>
    )
    expect(screen.getByRole("switch", { name: "off" }).props.accessibilityState).toMatchObject({ checked: false })
    expect(screen.getByRole("switch", { name: "on" }).props.accessibilityState).toMatchObject({ checked: true })
  })

  it("fills its track with the accent when on and the wash when off", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(
      <>
        <Switch label="on" value onValueChange={() => {}} />
        <Switch label="off" value={false} onValueChange={() => {}} />
      </>
    )
    expect(flat(screen.getByRole("switch", { name: "on" })).backgroundColor).toBe(light.accent)
    expect(flat(screen.getByRole("switch", { name: "off" })).backgroundColor).toBe(light.wash2)
  })

  it("slides its knob to the far end when on", async () => {
    await render(
      <>
        <Switch label="on" value onValueChange={() => {}} />
        <Switch label="off" value={false} onValueChange={() => {}} />
      </>
    )
    expect(knobOf("on").transform).toEqual([{ translateX: 18 }])
    expect(knobOf("off").transform).toEqual([{ translateX: 0 }])
  })

  it("does nothing when disabled, and says so", async () => {
    const onValueChange = jest.fn()
    await render(<Switch label="Can only read" value={false} disabled onValueChange={onValueChange} />)
    const control = screen.getByRole("switch", { name: "Can only read" })
    await fireEvent.press(control)
    expect(onValueChange).not.toHaveBeenCalled()
    expect(control.props.accessibilityState).toMatchObject({ disabled: true })
    expect(flat(control).opacity).toBe(0.4)
  })
})
