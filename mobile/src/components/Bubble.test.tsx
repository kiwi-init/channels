import { render, screen } from "@testing-library/react-native"
import { fold } from "@mc/state.ts"

import { fixtureMessages, fixtureRoster, SELF } from "../fixtures/channel"
import { Bubble, type BubbleProps } from "./Bubble"

const state = fold(fixtureMessages, fixtureRoster, Date.now())
const bySeq = new Map(fixtureMessages.map((m) => [m.seq, m]))

const base = (m: BubbleProps["m"], over: Partial<BubbleProps> = {}): BubbleProps => ({
  m,
  me: SELF,
  first: true,
  last: true,
  group: true,
  adjacentReply: false,
  quoted: (seq) => bySeq.get(seq),
  nameOf: (name) => name,
  onJump: () => {},
  ...over,
})

const chat = fixtureMessages.filter((m) => m.kind !== "event")

describe("Bubble", () => {
  it.each(chat.map((m) => [m.seq, m.kind, m] as const))("renders #%s (%s) from the fixture", async (_seq, _kind, m) => {
    await render(<Bubble {...base(m, { trust: state.trust.get(m.seq) })} />)
    expect(screen.getByTestId(`bubble-${m.seq}`)).toBeTruthy()
  })

  it("puts a tail on the last bubble of a run only", async () => {
    const m = chat[0]!
    await render(<Bubble {...base(m, { last: false })} />)
    expect(screen.queryByTestId("tail")).toBeNull()
    await render(<Bubble {...base(m, { last: true })} />)
    expect(screen.getByTestId("tail")).toBeTruthy()
  })

  it("names the sender in a group, and says what a question asks", async () => {
    const ask = chat.find((m) => m.kind === "ask")!
    await render(<Bubble {...base(ask)} />)
    expect(screen.getByText(ask.from)).toBeTruthy()
    expect(screen.getByText("asks you")).toBeTruthy()
  })

  it("marks a blocker, an escalation with a handoff, and a finish", async () => {
    const blocking = chat.find((m) => m.kind === "blocking" && !m.esc)!
    await render(<Bubble {...base(blocking)} />)
    expect(screen.getByText(/is blocked, needs/)).toBeTruthy()
    const esc = chat.find((m) => m.esc && m.handoff)!
    await render(<Bubble {...base(esc)} />)
    expect(screen.getByText("Browser for you")).toBeTruthy()
    const done = chat.find((m) => m.kind === "done")!
    await render(<Bubble {...base(done)} />)
    expect(screen.getAllByText("finished").length).toBeGreaterThan(0)
  })

  it("quotes what a reply answers unless it is right above, and jumps to it", async () => {
    const reply = chat.find((m) => m.re?.length && m.kind === "msg")!
    const jumped: number[] = []
    await render(<Bubble {...base(reply, { onJump: (seq) => jumped.push(seq) })} />)
    const target = bySeq.get(reply.re![0]!)!
    expect(screen.getByText(target.from)).toBeTruthy()
    await render(<Bubble {...base(reply, { adjacentReply: true })} />)
    expect(screen.queryByLabelText(`Jump to message ${target.seq}`)).toBeNull()
  })

  it("shows my receipt, but not another's", async () => {
    const mine = chat.find((m) => m.from === SELF)!
    await render(<Bubble {...base(mine, { receipt: "Read by 2" })} />)
    expect(screen.getByText("Read by 2")).toBeTruthy()
    const theirs = chat.find((m) => m.from !== SELF)!
    await render(<Bubble {...base(theirs, { receipt: "Read by 9" })} />)
    expect(screen.queryByText("Read by 9")).toBeNull()
  })

  it("says why a forged message is left out", async () => {
    const m = chat.find((m) => m.from !== SELF)!
    await render(<Bubble {...base({ ...m, pk: "abcdef123456" }, { trust: "forged" })} />)
    expect(screen.getByText(/Forged: not signed by/)).toBeTruthy()
    expect(screen.getByText(/Signed by key abcdef12/)).toBeTruthy()
  })

  it("shows an inline image without printing its file name as text", async () => {
    const m = chat.find((m) => m.imgs?.length)!
    await render(<Bubble {...base({ ...m, body: m.imgs!.map((i) => i.name).join(", ") })} />)
    expect(screen.getByLabelText("composer.png")).toBeTruthy()
    expect(screen.queryByText("composer.png")).toBeNull()
  })
})
