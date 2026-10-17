import { fireEvent, render, screen } from "@testing-library/react-native"
import { fold } from "@mc/state.ts"

import { fixtureMessages, fixtureRoster, SELF } from "../fixtures/channel"
import { TaskThread } from "./TaskThread"

const state = fold(fixtureMessages, fixtureRoster, Date.now())
const inTask = fixtureMessages.filter((m) => m.kind !== "event" && m.task !== undefined)

describe("TaskThread", () => {
  it("shows what was said in a task and sends a trimmed message", async () => {
    const onSend = jest.fn().mockResolvedValue(undefined)
    await render(<TaskThread messages={inTask} state={state} me={SELF} nameOf={(n) => n} onSend={onSend} />)
    expect(screen.getByText(`Conversation ${inTask.length}`)).toBeTruthy()
    for (const m of inTask) expect(screen.getByTestId(`bubble-${m.seq}`)).toBeTruthy()
    await fireEvent.press(screen.getByLabelText("Send"))
    expect(onSend).not.toHaveBeenCalled()
    await fireEvent.changeText(screen.getByLabelText("Say something in this task"), "  on it ")
    await fireEvent.press(screen.getByLabelText("Send"))
    expect(onSend).toHaveBeenCalledWith("on it")
  })

  it("says when nothing was said, and why sending is blocked", async () => {
    await render(<TaskThread messages={[]} state={state} me={SELF} nameOf={(n) => n} blocked="You can only read here" onSend={async () => {}} />)
    expect(screen.getByText("Nothing said here yet.")).toBeTruthy()
    expect(screen.getByText("You can only read here")).toBeTruthy()
    expect(screen.queryByLabelText("Send")).toBeNull()
  })
})
