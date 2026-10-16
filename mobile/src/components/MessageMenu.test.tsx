import { fireEvent, render, screen } from "@testing-library/react-native"
import * as Clipboard from "expo-clipboard"

import { fixtureMessages } from "../fixtures/channel"
import { clearToasts } from "../ui/Toast"
import { Frame } from "../ui/Frame"
import { MessageMenu } from "./MessageMenu"

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }))

const message = fixtureMessages[2]!

afterEach(() => {
  clearToasts()
  jest.clearAllMocks()
})

describe("MessageMenu", () => {
  it("is closed without a message", async () => {
    await render(
      <Frame>
        <MessageMenu message={null} onClose={() => {}} onReply={() => {}} />
      </Frame>
    )
    expect(screen.queryByLabelText("Reply")).toBeNull()
  })

  it("fires reply and react with the message, and closes", async () => {
    const onClose = jest.fn()
    const onReply = jest.fn()
    const onReact = jest.fn()
    await render(
      <Frame>
        <MessageMenu message={message} onClose={onClose} onReply={onReply} onReact={onReact} />
      </Frame>
    )
    await fireEvent.press(screen.getByLabelText("Reply"))
    expect(onReply).toHaveBeenCalledWith(message)
    await fireEvent.press(screen.getByLabelText("React"))
    expect(onReact).toHaveBeenCalledWith(message)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it("copies the text", async () => {
    const onClose = jest.fn()
    await render(
      <Frame>
        <MessageMenu message={message} onClose={onClose} />
      </Frame>
    )
    await fireEvent.press(screen.getByLabelText("Copy text"))
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(message.body)
    expect(onClose).toHaveBeenCalled()
  })

  it("leaves out an action that has no handler", async () => {
    await render(
      <Frame>
        <MessageMenu message={message} onClose={() => {}} onReply={() => {}} />
      </Frame>
    )
    expect(screen.queryByLabelText("React")).toBeNull()
    expect(screen.getByLabelText("Copy text")).toBeTruthy()
  })
})
