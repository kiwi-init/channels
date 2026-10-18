import { describe, expect, test } from "bun:test"

import { PROTOCOL_VERSION, type Message } from "@kiwi/core/protocol.ts"

import { lastPreview } from "./preview"

const chat = (from: string, seq: number, extra: Partial<Message> = {}): Message => ({
  v: PROTOCOL_VERSION,
  id: String(seq),
  from,
  kind: "msg",
  body: `${from}:${seq}`,
  ts: 0,
  seq,
  sigOk: true,
  ...extra,
})

describe("lastPreview", () => {
  test("skips events, self-notes and ignored lines", () => {
    const said = chat("lead", 1)
    const event = chat("lead", 2, { kind: "event" })
    const self = chat("dev", 3, { to: ["dev"] })
    const hidden = chat("dev", 4)
    expect(lastPreview([said, event, self, hidden], (seq) => (seq === 4 ? "refused" : undefined))?.seq).toBe(1)
  })

  test("an agent's line to everyone is the preview like anyone's", () => {
    expect(lastPreview([chat("lead", 1), chat("dev", 2)], () => undefined)?.from).toBe("dev")
    expect(lastPreview([], () => undefined)).toBeUndefined()
  })
})
