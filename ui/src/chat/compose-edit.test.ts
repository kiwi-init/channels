import { describe, expect, test } from "bun:test"
import { wrote } from "~/words"

import { lastOwn } from "~/chat/compose-edit"
import type { Message, Where } from "~/model"

const general: Where = { kind: "room", room: "general" }
const msg = (seq: number, text: string, more: Partial<Message> = {}): Message => ({ seq, from: "jow", at: seq, text: wrote(text), where: general, ...more })

describe("which message ↑ edits", () => {
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
})
