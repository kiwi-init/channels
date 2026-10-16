import { fireEvent, render, screen } from "@testing-library/react-native"
import { fold } from "@mc/state.ts"
import type { Message } from "@mc/protocol.ts"

import { fixtureMessages, fixtureRoster, SELF } from "../fixtures/channel"
import { buildRows } from "../lib/timeline"
import { Frame } from "../ui/Frame"
import { Conversation } from "./Conversation"

const mockMounts = new Map<number, number>()

jest.mock("./Bubble", () => {
  const React = jest.requireActual<typeof import("react")>("react")
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native")
  return {
    Bubble: ({ m }: { m: Message }) => {
      React.useEffect(() => {
        mockMounts.set(m.seq, (mockMounts.get(m.seq) ?? 0) + 1)
      }, [m.seq])
      return <Text>{`bubble ${m.seq}`}</Text>
    },
  }
})

const many = (count: number): Message[] =>
  Array.from({ length: count }, (_, i) => ({
    ...fixtureMessages[2]!,
    id: `n${i}`,
    seq: i + 1,
    ts: fixtureMessages[2]!.ts + i * 60_000,
    rts: fixtureMessages[2]!.ts + i * 60_000,
    from: i % 3 === 0 ? "jow" : "coordinator",
    pk: i % 3 === 0 ? "pk-jow" : "pk-coordinator",
  }))

const props = (messages: Message[]) => ({ messages, state: fold(messages, fixtureRoster, Date.now()), me: SELF, nameOf: (n: string) => n })

beforeEach(() => mockMounts.clear())

describe("timeline rows", () => {
  it("adds a day stamp per day, event rows, and run edges", () => {
    const state = fold(fixtureMessages, fixtureRoster, Date.now())
    const rows = buildRows(fixtureMessages, state, { me: SELF })
    expect(rows.filter((r) => r.type === "day")).toHaveLength(1)
    expect(rows.some((r) => r.type === "event")).toBe(true)
    expect(rows.filter((r) => r.type === "event").every((r) => !/hello|joined/.test(r.m.ev?.op ?? ""))).toBe(true)
    const bubbles = rows.filter((r) => r.type === "bubble")
    expect(bubbles[0]?.first).toBe(true)
    expect(bubbles.at(-1)?.last).toBe(true)
  })

  it("leaves out reactions, hellos and other places, and a day change starts a new run", () => {
    const state = fold(fixtureMessages, fixtureRoster, Date.now())
    const seqs = buildRows(fixtureMessages, state, { me: SELF }).flatMap((r) => (r.type === "day" ? [] : [r.m.seq]))
    for (const m of fixtureMessages) {
      if (m.ev?.op === "react" || m.ev?.op === "hello") expect(seqs).not.toContain(m.seq)
      if (m.dm || m.task !== undefined) expect(seqs).not.toContain(m.seq)
    }
    const a = { ...fixtureMessages[2]!, seq: 1, ts: new Date(2026, 9, 15, 23, 59).getTime() }
    const b = { ...a, seq: 2, ts: new Date(2026, 9, 16, 0, 1).getTime() }
    const rows = buildRows([a, b], fold([a, b], fixtureRoster, Date.now()), { me: SELF })
    expect(rows.filter((r) => r.type === "bubble").map((r) => r.first)).toEqual([true, true])
  })
})

describe("Conversation", () => {
  it("renders the newest messages of 500 and does not remount rows when one arrives", async () => {
    const first = many(500)
    const view = await render(
      <Frame>
        <Conversation {...props(first)} />
      </Frame>
    )
    expect(screen.getByText("bubble 500")).toBeTruthy()
    const before = new Map(mockMounts)
    expect(before.size).toBeGreaterThan(0)
    expect(before.size).toBeLessThan(500)

    const next = [...first, { ...first[0]!, id: "n500", seq: 501, ts: first.at(-1)!.ts + 60_000, rts: first.at(-1)!.ts + 60_000 }]
    await view.rerender(
      <Frame>
        <Conversation {...props(next)} />
      </Frame>
    )
    expect(screen.getByText("bubble 501")).toBeTruthy()
    for (const [seq, count] of before) expect(mockMounts.get(seq)).toBe(count)
    expect(mockMounts.get(501)).toBe(1)
  })

  it("shows the Latest pill only after scrolling away, and hides it again at the end", async () => {
    await render(
      <Frame>
        <Conversation {...props(many(60))} />
      </Frame>
    )
    expect(screen.queryByLabelText("Scroll to the latest message")).toBeNull()
    const list = screen.getByTestId("timeline")
    await fireEvent.scroll(list, { nativeEvent: { contentOffset: { y: 900 }, contentSize: { height: 4000, width: 300 }, layoutMeasurement: { height: 600, width: 300 } } })
    expect(screen.getByLabelText("Scroll to the latest message")).toBeTruthy()
    await fireEvent.scroll(list, { nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 4000, width: 300 }, layoutMeasurement: { height: 600, width: 300 } } })
    expect(screen.queryByLabelText("Scroll to the latest message")).toBeNull()
  })
})
