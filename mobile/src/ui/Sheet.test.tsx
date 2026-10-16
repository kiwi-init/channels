import { fireEvent, render, screen, waitFor } from "@testing-library/react-native"
import { Text as RNText } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { Sheet } from "./Sheet"

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }

function inApp(visible: boolean, onClose: () => void) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <Sheet visible={visible} onClose={onClose} title="Join with a code">
        <RNText>the form</RNText>
      </Sheet>
    </SafeAreaProvider>
  )
}

describe("Sheet", () => {
  it("renders nothing while closed", async () => {
    await render(inApp(false, jest.fn()))
    expect(screen.queryByText("the form")).toBeNull()
    expect(screen.queryByText("Join with a code")).toBeNull()
  })

  it("shows its title and children when open", async () => {
    await render(inApp(true, jest.fn()))
    expect(screen.getByText("Join with a code")).toBeTruthy()
    expect(screen.getByText("the form")).toBeTruthy()
  })

  it("closes on a tap on the backdrop", async () => {
    const onClose = jest.fn()
    await render(inApp(true, onClose))
    await fireEvent.press(screen.getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("closes on the system back gesture", async () => {
    const onClose = jest.fn()
    await render(inApp(true, onClose))
    await fireEvent(screen.getByTestId("sheet"), "requestClose")
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("leaves once it has animated out, and comes back when opened again", async () => {
    const onClose = jest.fn()
    const view = await render(inApp(true, onClose))
    await view.rerender(inApp(false, onClose))
    await waitFor(() => expect(screen.queryByText("the form")).toBeNull())
    await view.rerender(inApp(true, onClose))
    expect(screen.getByText("the form")).toBeTruthy()
  })
})
