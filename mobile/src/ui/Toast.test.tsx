import { act, render, screen } from "@testing-library/react-native"
import { StyleSheet } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

import { light } from "../theme/tokens"
import { Toaster, clearToasts, toast } from "./Toast"

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }

function host() {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <Toaster />
    </SafeAreaProvider>
  )
}

beforeEach(() => jest.useFakeTimers())
afterEach(async () => {
  await act(async () => clearToasts())
  jest.useRealTimers()
})

describe("toast", () => {
  it("shows a notice and takes it away after a moment", async () => {
    await render(host())
    await act(async () => toast("Copied"))
    expect(screen.getByText("Copied")).toBeTruthy()
    await act(async () => jest.advanceTimersByTime(2199))
    expect(screen.getByText("Copied")).toBeTruthy()
    await act(async () => jest.advanceTimersByTime(2))
    expect(screen.queryByText("Copied")).toBeNull()
  })

  it("keeps an error up longer and in the alert color", async () => {
    await render(host())
    await act(async () => toast("Not sent", "error"))
    const card = screen.getByRole("alert")
    expect(StyleSheet.flatten(card.props.style).backgroundColor).toBe(light.alertFill)
    await act(async () => jest.advanceTimersByTime(5000))
    expect(screen.getByText("Not sent")).toBeTruthy()
    await act(async () => jest.advanceTimersByTime(1100))
    expect(screen.queryByText("Not sent")).toBeNull()
  })

  it("keeps only the last three", async () => {
    await render(host())
    await act(async () => {
      for (const t of ["one", "two", "three", "four"]) toast(t)
    })
    expect(screen.queryByText("one")).toBeNull()
    expect(screen.getAllByRole("alert")).toHaveLength(3)
  })
})
