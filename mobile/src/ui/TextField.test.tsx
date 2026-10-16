import { fireEvent, render, screen } from "@testing-library/react-native"
import * as RN from "react-native"
import { StyleSheet } from "react-native"

import { dark, light } from "../theme/tokens"
import { TextField } from "./TextField"

afterEach(() => jest.restoreAllMocks())

function flat(node: { props: { style?: unknown } }) {
  const s = node.props.style
  return StyleSheet.flatten(typeof s === "function" ? s({ pressed: false }) : s)
}

const shellOf = (label: string) => screen.getByLabelText(label).parent as unknown as { props: { style?: unknown } }

describe("TextField", () => {
  it("hands every keystroke to the caller", async () => {
    const onChangeText = jest.fn()
    await render(<TextField label="Join code" placeholder="mc2-…" onChangeText={onChangeText} />)
    const field = screen.getByLabelText("Join code")
    await fireEvent.changeText(field, "mc2-a-b")
    expect(onChangeText).toHaveBeenCalledWith("mc2-a-b")
    expect(field.props.placeholder).toBe("mc2-…")
  })

  it("fills with the canvas and borders with the line, and turns the border into the ring while focused", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("light")
    await render(<TextField label="Nickname" />)
    expect(flat(shellOf("Nickname")).backgroundColor).toBe(light.canvas)
    expect(flat(shellOf("Nickname")).borderColor).toBe(light.line)
    await fireEvent(screen.getByLabelText("Nickname"), "focus")
    expect(flat(shellOf("Nickname")).borderColor).toBe(light.ring)
    await fireEvent(screen.getByLabelText("Nickname"), "blur")
    expect(flat(shellOf("Nickname")).borderColor).toBe(light.line)
  })

  it("writes the placeholder in quiet ink and follows the dark scheme", async () => {
    jest.spyOn(RN, "useColorScheme").mockReturnValue("dark")
    await render(<TextField label="Nickname" placeholder="e.g. claude" />)
    const field = screen.getByLabelText("Nickname")
    expect(field.props.placeholderTextColor).toBe(dark.ink3)
    expect(flat(field).color).toBe(dark.ink)
    expect(flat(shellOf("Nickname")).backgroundColor).toBe(dark.canvas)
  })

  it("dims itself and takes no typing when it isn't editable", async () => {
    await render(<TextField label="Code" editable={false} />)
    expect(screen.getByLabelText("Code").props.editable).toBe(false)
    expect(flat(shellOf("Code")).opacity).toBe(0.4)
  })

  it("grows for a multi-line field instead of holding one line's height", async () => {
    await render(<TextField label="Message" multiline />)
    const shell = flat(shellOf("Message"))
    expect(shell.height).toBeUndefined()
    expect(shell.minHeight).toBe(40)
  })
})
