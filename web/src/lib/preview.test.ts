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
  test("skips events, self-notes, ignored, and lines that do not reach this viewer", () => {
    const event = chat("coord", 1, { kind: "event" })
    const self = chat("dev", 2, { to: ["dev"] })
    const hidden = chat("dev", 3)
    const coord = chat("coord", 4)
    const messages = [event, self, hidden, coord]
    const last = lastPreview(
      messages,
      (m) => m.from === "coord",
      (seq) => (seq === 3 ? "refused" : undefined)
    )
    expect(last?.seq).toBe(4)
  })

  test("an agent-to-agent line is not the preview when it does not reach a person", () => {
    const agent = chat("dev", 1)
    const coord = chat("coord", 2)
    expect(
      lastPreview(
        [agent, coord],
        (m) => m.from === "coord",
        () => undefined
      )?.from
    ).toBe("coord")
    expect(
      lastPreview(
        [agent],
        () => false,
        () => undefined
      )
    ).toBeUndefined()
  })
})
