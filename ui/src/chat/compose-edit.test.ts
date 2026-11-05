import { describe, expect, test } from "bun:test"

import { lastOwn, nextEdit } from "~/chat/compose-edit"
import type { Message, Where } from "~/model"

const general: Where = { kind: "room", room: "general" }
const msg = (seq: number, text: string, more: Partial<Message> = {}): Message => ({ seq, from: "jow", at: seq, text, where: general, ...more })

describe("editing in the composer (T5115)", () => {
  test("↑ in an empty composer opens your last message here", () => {
    const messages = [
      msg(1, "mine, older", { canChange: true }),
      msg(2, "mine, last", { canChange: true }),
      msg(3, "theirs"),
      msg(4, "mine elsewhere", { canChange: true, where: { kind: "task", task: 7 } }),
    ]
    expect(lastOwn(messages, general)?.seq).toBe(2)
    expect(lastOwn(messages, { kind: "room", room: "ops" })).toBeUndefined()
  })

  test("picking Edit loads the message over the draft, and Esc puts the draft back", () => {
    const started = nextEdit(null, msg(2, "ship it today", { canChange: true }), "a half-typed draft")
    expect(started).toEqual({ edit: { seq: 2, was: "a half-typed draft" }, text: "ship it today" })
    expect(nextEdit(started!.edit, msg(2, "ship it today"), "ship it tomorrow")).toBeNull()
    expect(nextEdit(started!.edit, undefined, "ship it tomorrow")).toEqual({ edit: null, text: "a half-typed draft" })
  })

  test("switching to another message keeps the draft from before the first edit", () => {
    const first = nextEdit(null, msg(2, "one"), "my draft")!.edit
    const second = nextEdit(first, msg(5, "two"), "one, changed")
    expect(second).toEqual({ edit: { seq: 5, was: "my draft" }, text: "two" })
    expect(nextEdit(null, undefined, "anything")).toBeNull()
  })
})
