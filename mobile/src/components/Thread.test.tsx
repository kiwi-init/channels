import { render, screen } from "@testing-library/react-native"
import { fold } from "@mc/state.ts"
import { Text } from "react-native"

import { fixtureMessages, fixtureRoster, SELF } from "../fixtures/channel"
import { repliesLabel, threadIndex } from "../lib/thread"
import { Frame } from "../ui/Frame"
import { Thread } from "./Thread"

const root = fixtureMessages[2]!
const replies = [
  { ...fixtureMessages[3]!, seq: 40, re: [root.seq], ts: root.ts + 60_000 },
  { ...fixtureMessages[3]!, seq: 41, re: [40], ts: root.ts + 120_000, body: "second reply" },
  { ...fixtureMessages[2]!, seq: 42, re: [41], ts: root.ts + 180_000, body: "third reply" },
]
const messages = [...fixtureMessages, ...replies]
const state = fold(messages, fixtureRoster, Date.now())

describe("threads", () => {
  it("find a root's replies through the chain, and leave a root with none out", () => {
    const index = threadIndex(messages, state)
    expect(index.replies.get(root.seq)?.map((m) => m.seq)).toEqual([4, 40, 41, 42])
    expect(index.rootOf(41)).toBe(root.seq)
    expect(index.rootOf(root.seq)).toBeNull()
  })

  it("says how many replies", () => {
    expect(repliesLabel(1)).toBe("1 Reply")
    expect(repliesLabel(3)).toBe("3 Replies")
  })
})

describe("Thread", () => {
  it("renders the root and three replies with the composer under them, and closes", async () => {
    const onClose = jest.fn()
    await render(
      <Frame>
        <Thread root={root} replies={replies} state={state} me={SELF} nameOf={(n) => n} composer={<Text>composer here</Text>} onClose={onClose} />
      </Frame>
    )
    for (const m of [root, ...replies]) expect(screen.getByTestId(`bubble-${m.seq}`)).toBeTruthy()
    expect(screen.getByText("composer here")).toBeTruthy()
    expect(screen.getByText(/3 replies/)).toBeTruthy()
    screen.getByLabelText("Close thread").props.onClick?.()
  })
})
