import { fireEvent, render, screen } from "@testing-library/react-native"

import { AGENTS_NOW, fixtureAgents } from "../fixtures/agents"
import { Frame } from "../ui/Frame"
import { AgentFacts } from "./AgentFacts"
import { AgentStrip } from "./AgentStrip"

function strip(over: Partial<React.ComponentProps<typeof AgentStrip>> = {}) {
  return (
    <Frame>
      <AgentStrip agents={fixtureAgents} now={AGENTS_NOW} onOpenTask={jest.fn()} {...over} />
    </Frame>
  )
}

describe("AgentStrip", () => {
  it("shows nothing when there are no agents", async () => {
    await render(strip({ agents: [] }))
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("says in one line who is working on what", async () => {
    await render(strip())
    expect(screen.getByText("2 working")).toBeTruthy()
    expect(screen.getByRole("button", { name: /^2 working\. Browser on S20 Agents strip and agent sheet/ })).toBeTruthy()
  })

  it("opens into one row per agent with its state: online and busy, idle, away and away since", async () => {
    await render(strip())
    expect(screen.queryByLabelText("What the agents are doing")).toBeNull()
    await fireEvent.press(screen.getByRole("button", { name: /working/ }))
    expect(screen.getByLabelText("What the agents are doing")).toBeTruthy()
    expect(screen.getByText("Running Bash")).toBeTruthy()
    expect(screen.getByText("Idle")).toBeTruthy()
    expect(screen.queryByText("Listening")).toBeNull()
    expect(screen.getAllByText("online").length).toBe(3)
    expect(screen.getAllByText("away").length).toBe(2)
    expect(screen.getAllByText("Not listening")).toHaveLength(2)
    expect(screen.getByText("2 queued")).toBeTruthy()
    expect(screen.getByText("1 waiting for review")).toBeTruthy()
  })

  it("opens a task from a row, naming the task", async () => {
    const onOpenTask = jest.fn()
    await render(strip({ onOpenTask }))
    await fireEvent.press(screen.getByRole("button", { name: /working/ }))
    await fireEvent.press(screen.getByRole("link", { name: "Open T788 S20 Agents strip and agent sheet" }))
    expect(onOpenTask).toHaveBeenCalledWith(788)
  })

  it("opens an agent's sheet with its card when a row is tapped", async () => {
    await render(strip())
    await fireEvent.press(screen.getByRole("button", { name: /working/ }))
    await fireEvent.press(screen.getByRole("button", { name: "Coordinator, online" }))
    expect(screen.getByText("claude-sonnet-5-5 · Claude Code")).toBeTruthy()
    expect(screen.getByText("macOS arm64 · 8 cores · Apple M2 · 8 GB")).toBeTruthy()
    expect(screen.getByText("git, bun, xcode")).toBeTruthy()
  })
})

describe("AgentFacts", () => {
  it("says so when an older kiwi sent no card, and labels a join request's word", async () => {
    const view = await render(<AgentFacts card={undefined} />)
    expect(screen.getByText("Didn’t say its model (an older kiwi)")).toBeTruthy()
    await view.rerender(<AgentFacts card={{ model: "gpt-5-codex", harness: "codex" }} said />)
    expect(screen.getByText("gpt-5-codex · Codex · its word")).toBeTruthy()
  })
})
