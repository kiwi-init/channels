import { fireEvent, render, screen } from "@testing-library/react-native"

import { NOW, fixtureIcons, fixtureNews, fixtureRows } from "../fixtures/channels"
import { ChannelList, rowNote } from "./ChannelList"

function list(over: Partial<React.ComponentProps<typeof ChannelList>> = {}) {
  return <ChannelList rows={fixtureRows} news={fixtureNews} icons={fixtureIcons} now={NOW} onSelect={jest.fn()} onNew={jest.fn()} {...over} />
}

const row = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title},`) })

describe("rowNote", () => {
  it("says what was said last, or why a channel cannot be opened, or that it is quiet", () => {
    expect(rowNote(fixtureRows[0]!)).toBe("kiwi-sh: T600 is yours, start after T500")
    expect(rowNote(fixtureRows[3]!)).toBe("No messages yet")
    expect(rowNote(fixtureRows[4]!)).toBe("Waiting for the owner to let you in")
    expect(rowNote(fixtureRows[5]!)).toBe("2 of your agents are here")
    expect(rowNote(fixtureRows[6]!)).toBe("One of your agents is here")
  })
})

describe("ChannelList", () => {
  it("starts with a New channel row that calls back", async () => {
    const onNew = jest.fn()
    await render(list({ onNew }))
    await fireEvent.press(screen.getByRole("button", { name: "New channel" }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it("shows every row from the fixture with its title and what was said last", async () => {
    await render(list())
    for (const c of fixtureRows) expect(screen.getByText(c.title)).toBeTruthy()
    expect(screen.getByText("merge-bus: bus is green, three landed")).toBeTruthy()
    expect(screen.getByText("No messages yet")).toBeTruthy()
  })

  it("calls back with the channel's code when a row is tapped", async () => {
    const onSelect = jest.fn()
    await render(list({ onSelect }))
    await fireEvent.press(row("Ops"))
    expect(onSelect).toHaveBeenCalledWith("c-ops")
  })

  it("marks a fresh row with a dot, and a row with questions with a count", async () => {
    await render(list())
    expect(row("channels-dev").props.accessibilityLabel).toContain("new messages")
    expect(row("Ops").props.accessibilityLabel).toContain("2 for you")
    expect(screen.getByLabelText("2 questions for you")).toBeTruthy()
    expect(screen.getByLabelText("A question for you")).toBeTruthy()
    expect(row("Quiet").props.accessibilityLabel).not.toMatch(/for you|new messages/)
  })

  it("does not call the open channel fresh", async () => {
    await render(list({ active: "c-dev" }))
    expect(row("channels-dev").props.accessibilityLabel).not.toContain("new messages")
    expect(row("channels-dev").props.accessibilityState).toMatchObject({ selected: true })
  })

  it("says when each was last heard from, and Pending or Locked for the ones that cannot be opened", async () => {
    await render(list())
    expect(row("channels-dev").props.accessibilityLabel).toMatch(/^channels-dev, .+: kiwi-sh: T600/)
    expect(row("Design").props.accessibilityLabel).toContain("Yesterday")
    expect(row("Friends").props.accessibilityLabel).toContain("Pending")
    expect(row("Home lab").props.accessibilityLabel).toContain("Locked")
  })

  it("shows the coordinator's robot when it spoke last, and the channel's icon otherwise", async () => {
    await render(list())
    expect(screen.getByLabelText("The coordinator spoke last")).toBeTruthy()
    expect(screen.getByText("🛠")).toBeTruthy()
  })

  it("says so when there are no channels", async () => {
    await render(list({ rows: [], news: [] }))
    expect(screen.getByText("Channels you create or join show up here.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "New channel" })).toBeTruthy()
  })
})
