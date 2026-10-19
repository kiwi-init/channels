import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { Load } from "@kiwi/core/load.ts"
import type { Task } from "@kiwi/core/state.ts"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
const { AgentRow, agentNow } = await import("./agent-strip")

const task = { id: 7, title: "Write fewer rows per message" } as unknown as Task
const load = (current: Task[]): Load => ({ level: current.length ? "busy" : "free", current, queued: [], waiting: [] })
const html = (current: Task[]) =>
  renderToStaticMarkup(createElement(AgentRow, { a: { name: "atlas", label: "atlas", color: null, here: null, lead: true, load: load(current) }, onMessage: () => {}, onOpenTask: () => {} }))

describe("an agent in the channel's sidebar", () => {
  test("the row opens your direct conversation with it, and its task is its own button beside it", () => {
    const out = html([task])
    expect(out).toContain('aria-label="Message atlas privately"')
    expect(out).toContain('aria-label="Open T7, Write fewer rows per message"')
    expect(out.match(/<button/g)).toHaveLength(2)
    expect(out).not.toContain("disabled")
  })
  test("with no task, the row still opens the conversation and there is no task button", () => {
    const out = html([])
    expect(out).toContain('aria-label="Message atlas privately"')
    expect(out.match(/<button/g)).toHaveLength(1)
  })
})

describe("an agent's one status", () => {
  const agent = (here: "listening" | null, current: Task[], activity?: { state: "working"; tool?: string }) => ({
    name: "win",
    label: "win",
    color: null,
    here,
    lead: false,
    load: load(current),
    ...(activity ? { activity } : {}),
  })

  test("away is away, even holding a task: not counted as working", () => {
    expect(agentNow(agent(null, [task]))).toEqual({ text: "Away", busy: false })
  })
  test("reachable with a task and no live word from its harness: on that task, and working", () => {
    expect(agentNow(agent("listening", [task]))).toEqual({ text: "On T7", busy: true })
  })
  test("what its harness says now wins", () => {
    expect(agentNow(agent("listening", [task], { state: "working", tool: "Bash" }))).toEqual({ text: "Running Bash", busy: true })
  })
  test("reachable with nothing to do says how it's reached", () => {
    expect(agentNow(agent("listening", []))).toEqual({ text: "Listening", busy: false })
  })
})
