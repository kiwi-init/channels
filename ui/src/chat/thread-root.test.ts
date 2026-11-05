import { describe, expect, test } from "bun:test"

import { threadRoot } from "~/chat/thread-root"

describe("a thread opened on a reply opens its own thread, never one nested in it (T3844)", () => {
  const messages = [{ seq: 10 }, { seq: 11, inThread: 10 }, { seq: 12, inThread: 10 }, { seq: 20 }]

  test("a reply opens the thread it's in, scrolled to that reply", () => {
    expect(threadRoot(messages, 11)).toEqual({ seq: 10, focus: 11 })
    expect(threadRoot(messages, 12, 11)).toEqual({ seq: 10, focus: 11 })
  })

  test("a thread's first message and a message the app doesn't hold open as they are", () => {
    expect(threadRoot(messages, 10)).toEqual({ seq: 10, focus: undefined })
    expect(threadRoot(messages, 10, 12)).toEqual({ seq: 10, focus: 12 })
    expect(threadRoot(messages, 99)).toEqual({ seq: 99, focus: undefined })
  })
})
