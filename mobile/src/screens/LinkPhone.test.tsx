import { Text as RNText } from "react-native"
import { fireEvent, render, screen } from "@testing-library/react-native"

import { NOT_A_LINK_CODE } from "../lib/linkPhone"
import { LinkPhone, digitsLine } from "./LinkPhone"

const noop = async () => {}

function screenFor(over: Partial<React.ComponentProps<typeof LinkPhone>> = {}) {
  return <LinkPhone engine={{ adopt: noop }} onLinked={jest.fn()} deviceName="Ada's iPhone" Scanner={() => null} {...over} />
}

describe("digitsLine", () => {
  it("splits six digits in two groups of three", () => {
    expect(digitsLine("012345")).toBe("012 345")
    expect(digitsLine("12")).toBe("12")
  })
})

describe("LinkPhone", () => {
  it("explains where the code is, and keeps Link off until something is pasted", async () => {
    await render(screenFor())
    expect(screen.getByText(/Link a phone/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Link" }).props.accessibilityState).toMatchObject({ disabled: true })
    await fireEvent.changeText(screen.getByLabelText("Link code"), "kl1-x")
    expect(screen.getByRole("button", { name: "Link" }).props.accessibilityState).toMatchObject({ disabled: false })
  })

  it("says what is wrong with something that is not a link code, and offers to try again", async () => {
    await render(screenFor())
    await fireEvent.changeText(screen.getByLabelText("Link code"), "mc2-a-join-code")
    await fireEvent.press(screen.getByRole("button", { name: "Link" }))
    expect(await screen.findByText(NOT_A_LINK_CODE)).toBeTruthy()
    await fireEvent.press(screen.getByRole("button", { name: "Try again" }))
    expect(screen.getByLabelText("Link code").props.value).toBe("")
  })

  it("opens the scanner from Scan the code and comes back from it", async () => {
    const Scanner = ({ onClose }: { onCode: (t: string) => void; onClose: () => void }) => <RNText onPress={onClose}>scanner open</RNText>
    await render(screenFor({ Scanner }))
    await fireEvent.press(screen.getByRole("button", { name: "Scan the code" }))
    expect(screen.getByText("scanner open")).toBeTruthy()
    await fireEvent.press(screen.getByText("scanner open"))
    expect(screen.getByLabelText("Link code")).toBeTruthy()
  })

  it("hands a scanned code to the flow", async () => {
    const Scanner = ({ onCode }: { onCode: (t: string) => void; onClose: () => void }) => <RNText onPress={() => onCode("scanned-garbage")}>scanner open</RNText>
    await render(screenFor({ Scanner }))
    await fireEvent.press(screen.getByRole("button", { name: "Scan the code" }))
    await fireEvent.press(screen.getByText("scanner open"))
    expect(await screen.findByText(NOT_A_LINK_CODE)).toBeTruthy()
  })
})
