import { fireEvent, render, screen } from "@testing-library/react-native"
import { Frame } from "./Frame"
import { ImageViewer } from "./ImageViewer"

function viewer(over: Partial<React.ComponentProps<typeof ImageViewer>> = {}) {
  return (
    <Frame>
      <ImageViewer visible onClose={jest.fn()} uri="data:image/png;base64,AAAA" title="shot.png" {...over} />
    </Frame>
  )
}

describe("ImageViewer", () => {
  it("renders nothing while closed", async () => {
    await render(viewer({ visible: false }))
    expect(screen.queryByLabelText("shot.png")).toBeNull()
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
  })

  it("shows the image, its name and a close button that calls back", async () => {
    const onClose = jest.fn()
    await render(viewer({ onClose }))
    expect(screen.getByLabelText("shot.png")).toBeTruthy()
    expect(screen.getByText("shot.png")).toBeTruthy()
    await fireEvent.press(screen.getByRole("button", { name: "Close" }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("offers Share only when there is something to share it with", async () => {
    const onShare = jest.fn()
    const view = await render(viewer())
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull()
    await view.rerender(viewer({ onShare }))
    await fireEvent.press(screen.getByRole("button", { name: "Share" }))
    expect(onShare).toHaveBeenCalledTimes(1)
  })
})
