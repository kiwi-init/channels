import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import type { Load } from "@kiwi/core/load.ts"
import type { Task } from "@kiwi/core/state.ts"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", harnessUrl: () => "" }))
const { AgentRow } = await import("./agent-strip")

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
