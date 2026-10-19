import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { Load } from "@kiwi/core/load.ts"
import { fold, type Task } from "@kiwi/core/state.ts"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue", harnessUrl: () => "" }))
const { AgentRow, AgentStrip, contextNow } = await import("./agent-strip")
const { AgentLanes } = await import("./agent-lanes")

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

describe("an agent's context on its lane", () => {
  const agent = (here: boolean, context?: { used: number; window?: number }) => ({
    name: "atlas",
    label: "atlas",
    color: null,
    here: here ? ("listening" as const) : null,
    lead: false,
    load: load([]),
    activity: { state: "idle" as const, ...(context ? { context } : {}) },
  })
  test("its size and window in words, flagged past the line", () => {
    expect(contextNow(agent(true, { used: 262_000, window: 1_000_000 }))).toEqual({ text: "262k of 1M context", over: true })
    expect(contextNow(agent(true, { used: 64_490 }))).toEqual({ text: "64k context", over: false })
  })
  test("the lane and the agent list under the composer show it, in the alert colour past the line", () => {
    const over = agent(true, { used: 262_000, window: 1_000_000 })
    const under = { ...agent(true, { used: 64_490 }), name: "bo", label: "bo" }
    const lanes = renderToStaticMarkup(createElement(AgentLanes, { agents: [over, under], state: fold([], []), messages: [], now: 0, nameOf: (n: string) => n, onOpenTask: () => {} }))
    const strip = renderToStaticMarkup(createElement(AgentStrip, { agents: [over, under], now: 0, onOpenTask: () => {} }))
    for (const out of [lanes, strip]) {
      expect(out).toMatch(/class="[^"]*text-alert[^"]*">[^<]*262k of 1M context/)
      expect(out).toMatch(/class="[^"]*text-ink-3[^"]*">[^<]*64k context/)
    }
  })
  test("nothing when its harness doesn't say, or it isn't here", () => {
    expect(contextNow(agent(true))).toBeNull()
    expect(contextNow(agent(false, { used: 262_000 }))).toBeNull()
  })
})
