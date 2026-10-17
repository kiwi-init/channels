import { fireEvent, render, screen } from "@testing-library/react-native"
import { fold } from "@mc/state.ts"

import { fixtureMessages, fixtureRoster, SELF } from "../fixtures/channel"
import { Frame } from "../ui/Frame"
import { Conversation } from "./Conversation"

const root = fixtureMessages[2]!
const replies = [
  { ...fixtureMessages[3]!, seq: 40, re: [root.seq], ts: root.ts + 60_000, body: "reply forty" },
  { ...fixtureMessages[3]!, seq: 41, re: [40], ts: root.ts + 120_000, body: "reply forty-one" },
]
const messages = [...fixtureMessages, ...replies]
const state = fold(messages, fixtureRoster, Date.now())

describe("threads in the conversation", () => {
  it("keeps replies out of the main list and names them under their root, which opens the thread", async () => {
    const onOpenThread = jest.fn()
    await render(
      <Frame>
        <Conversation messages={messages} state={state} me={SELF} nameOf={(n) => n} onOpenThread={onOpenThread} />
      </Frame>
    )
    expect(screen.queryByText("reply forty")).toBeNull()
    expect(screen.queryByText("reply forty-one")).toBeNull()
    await fireEvent.press(screen.getByLabelText("Open thread, 3 Replies"))
    expect(onOpenThread).toHaveBeenCalledWith(root.seq)
  })
})
