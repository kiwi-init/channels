import { fireEvent, render, screen } from "@testing-library/react-native"
import { fold } from "@mc/state.ts"

import { fixtureMessages, fixtureRoster, SELF } from "../fixtures/channel"
import { Frame } from "../ui/Frame"
import { ImageViewer } from "../ui/ImageViewer"
import { Conversation } from "./Conversation"

describe("opening an image from the timeline", () => {
  it("hands the tapped image and its message up, and the viewer shows it", async () => {
    const withImage = fixtureMessages.find((m) => m.imgs?.length && m.kind !== "event")!
    const plain = fixtureMessages.find((m) => m.kind === "msg" && !m.re?.length && m.task === undefined && !m.dm && !m.imgs?.length)!
    const messages = [{ ...plain, imgs: withImage.imgs, body: withImage.imgs!.map((i) => i.name).join(", ") }]
    const opened: { name: string; seq: number }[] = []
    const props = { messages, state: fold(messages, fixtureRoster, Date.now()), me: SELF, nameOf: (n: string) => n }
    const view = await render(
      <Frame>
        <Conversation {...props} onOpenImage={(img, m) => opened.push({ name: img.name, seq: m.seq })} />
      </Frame>
    )
    await fireEvent.press(screen.getByRole("imagebutton", { name: "Open composer.png" }))
    expect(opened).toEqual([{ name: "composer.png", seq: plain.seq }])

    const img = withImage.imgs![0]!
    await view.rerender(
      <Frame>
        <ImageViewer visible onClose={jest.fn()} uri={`data:${img.mime};base64,${img.data}`} title={img.name} />
      </Frame>
    )
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy()
  })
})
