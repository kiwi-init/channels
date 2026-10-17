import { fireEvent, render, screen } from "@testing-library/react-native"
import type { Task } from "@mc/state.ts"

import { fixtureMessages } from "../fixtures/channel"
import { NeedsYou, type NeedsYouProps } from "./NeedsYou"

const NOW = Date.UTC(2026, 9, 16, 15, 0, 0)
const escalation = { ...fixtureMessages.find((m) => m.esc && m.handoff)!, handoff: { url: "https://example.com/h/1", vendor: "example", expiresAt: NOW + 600_000 } }
const question = fixtureMessages.find((m) => m.kind === "ask")!
const review: Task = { id: 7, title: "Mobile: Expo app", state: "review", createdBy: "jow", createdAt: NOW, updatedAt: NOW, notes: [], workedBy: [], rounds: [], review: "*" }

const props = (over: Partial<NeedsYouProps> = {}): NeedsYouProps => ({
  now: NOW,
  me: "jow",
  requests: [],
  escalations: [],
  questions: [],
  reviews: [],
  nameOf: (n) => n,
  onCheckRequest: jest.fn().mockResolvedValue(undefined),
  onApproveRequest: jest.fn().mockResolvedValue(undefined),
  onDenyRequest: jest.fn().mockResolvedValue(undefined),
  onReply: jest.fn().mockResolvedValue(undefined),
  onApproveTask: jest.fn().mockResolvedValue(undefined),
  onSendBack: jest.fn().mockResolvedValue(undefined),
  onOpenTask: jest.fn(),
  onJump: jest.fn(),
  ...over,
})

describe("NeedsYou", () => {
  it("says when nothing needs you", async () => {
    await render(<NeedsYou {...props()} />)
    expect(screen.getByText("Nothing needs you right now.")).toBeTruthy()
  })

  it("a join request: start the check, then approve only once the digits are ready, or deny", async () => {
    const p = props({ requests: [{ id: "r1", name: "Ann", role: "designer", code: null, check: "unchecked" }] })
    await render(<NeedsYou {...p} />)
    expect(screen.getByText("Ann wants to join")).toBeTruthy()
    await fireEvent.press(screen.getByLabelText("Approve"))
    expect(p.onApproveRequest).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByLabelText("Start check"))
    expect(p.onCheckRequest).toHaveBeenCalledWith("r1")
    await fireEvent.press(screen.getByLabelText("Deny"))
    expect(p.onDenyRequest).toHaveBeenCalledWith("r1")

    const ready = props({ requests: [{ id: "r2", name: "Bo", code: "344-230", check: "ready" }] })
    await render(<NeedsYou {...ready} />)
    expect(screen.getByText(/344-230/)).toBeTruthy()
    await fireEvent.press(screen.getByLabelText("Approve"))
    expect(ready.onApproveRequest).toHaveBeenCalledWith("r2")
  })

  it("an escalation with a handoff: open the browser, jump to it, and reply", async () => {
    const p = props({ escalations: [escalation] })
    await render(<NeedsYou {...p} />)
    expect(screen.getByText(/Browser for you from/)).toBeTruthy()
    expect(screen.getByLabelText("Open browser")).toBeTruthy()
    await fireEvent.press(screen.getByLabelText("Answer"))
    await fireEvent.changeText(screen.getByLabelText(`Reply to ${escalation.from}`), " use the team A account ")
    await fireEvent.press(screen.getByLabelText("Send reply"))
    expect(p.onReply).toHaveBeenCalledWith(escalation, "use the team A account")
    await fireEvent.press(screen.getByLabelText("Show"))
    expect(p.onJump).toHaveBeenCalledWith(escalation.seq)
  })

  it("an expired handoff says so and offers no browser", async () => {
    await render(<NeedsYou {...props({ escalations: [{ ...escalation, handoff: { ...escalation.handoff!, expiresAt: NOW - 1 } }] })} />)
    expect(screen.getByText("Link expired")).toBeTruthy()
    expect(screen.queryByLabelText("Open browser")).toBeNull()
  })

  it("a question for you can be answered", async () => {
    const p = props({ questions: [question] })
    await render(<NeedsYou {...p} />)
    expect(screen.getByText(/Question for you from/)).toBeTruthy()
    await fireEvent.press(screen.getByLabelText("Answer"))
    await fireEvent.changeText(screen.getByLabelText(`Reply to ${question.from}`), "yes")
    await fireEvent.press(screen.getByLabelText("Send reply"))
    expect(p.onReply).toHaveBeenCalledWith(question, "yes")
  })

  it("an ask-human decision: each option answers with its text, and Something else opens a free reply", async () => {
    const decision = { ...question, esc: true as const, to: ["jow"], choices: ["Use A", "Use B"] }
    const p = props({ escalations: [decision] })
    await render(<NeedsYou {...p} />)
    await fireEvent.press(screen.getByLabelText("Answer: Use B"))
    expect(p.onReply).toHaveBeenCalledWith(decision, "Use B")
    expect(screen.queryByLabelText("Answer")).toBeNull()
    await fireEvent.press(screen.getByLabelText("Something else"))
    await fireEvent.changeText(screen.getByLabelText(`Reply to ${decision.from}`), "neither")
    await fireEvent.press(screen.getByLabelText("Send reply"))
    expect(p.onReply).toHaveBeenLastCalledWith(decision, "neither")
  })

  it("a browser handoff answers Done or Couldn't with the protocol words", async () => {
    const p = props({ escalations: [escalation] })
    await render(<NeedsYou {...p} />)
    await fireEvent.press(screen.getByLabelText("Done"))
    expect(p.onReply).toHaveBeenCalledWith(escalation, "handoff: done")
    await fireEvent.press(screen.getByLabelText("Couldn’t"))
    expect(p.onReply).toHaveBeenLastCalledWith(escalation, "handoff: failed")
  })

  it("a review: approve, open, or send back with a reason", async () => {
    const p = props({ reviews: [review] })
    await render(<NeedsYou {...p} />)
    await fireEvent.press(screen.getByLabelText("Approve"))
    expect(p.onApproveTask).toHaveBeenCalledWith(review)
    await fireEvent.press(screen.getByLabelText("Open task"))
    expect(p.onOpenTask).toHaveBeenCalledWith(7)
    await fireEvent.press(screen.getByLabelText("Send back"))
    await fireEvent.changeText(screen.getByLabelText("Why"), "  tests missing ")
    await fireEvent.press(screen.getByLabelText("Send it back"))
    expect(p.onSendBack).toHaveBeenCalledWith(review, "tests missing")
  })
})
