import { describe, expect, test } from "bun:test"
import type { Message } from "@kiwi/core/protocol.ts"
import { logFileName, logLines } from "./log-export"

const message = (seq: number, body: string): Message => ({ seq, rts: 1_760_000_000_000 + seq, ts: 1_760_000_000_000 + seq, from: "ana", pk: `pk-${seq}`, sig: `sig-${seq}`, body, sigOk: true })

describe("a channel's log, kept before it closes", () => {
  test("is one JSON line per message, oldest first, each with its author's key and signature", () => {
    const out = logLines([message(1, "hello"), message(2, 'a "quoted"\nline')])
    const lines = out.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe("")
    const parsed: unknown[] = lines.slice(0, 2).map((l) => JSON.parse(l))
    expect(parsed).toEqual([message(1, "hello"), message(2, 'a "quoted"\nline')])
  })

  test("an empty log is an empty file", () => {
    expect(logLines([])).toBe("")
  })

  test("is saved under the channel's name and the day, a name with nothing to keep falling back to channel", () => {
    const at = new Date("2026-10-20T12:00:00Z")
    expect(logFileName("Inbox Zero: Q4 plan", at)).toBe("inbox-zero-q4-plan-log-2026-10-20.jsonl")
    expect(logFileName("Café über_alles", at)).toBe("cafe-uber-alles-log-2026-10-20.jsonl")
    expect(logFileName("🚀🚀", at)).toBe("channel-log-2026-10-20.jsonl")
    expect(logFileName(undefined, at)).toBe("channel-log-2026-10-20.jsonl")
    expect(logFileName(`${"a".repeat(59)} b`, at)).toBe(`${"a".repeat(59)}-log-2026-10-20.jsonl`)
  })
})
