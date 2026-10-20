import { describe, expect, test } from "bun:test"
import type { Message } from "@kiwi/core/protocol.ts"
import { exportNote, logExport, logFileName, logLines } from "./log-export"

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

  test("an empty log is an empty file, and complete", () => {
    const log = logExport({ head: 0, messages: [], first: null })
    expect(log).toEqual({ text: "", missing: [], dropped: 0 })
    expect(exportNote(log)).toEqual({ text: "Log downloaded.", complete: true })
  })

  test("every seq from the first the relay kept to the head is either in the file or named as missing", () => {
    const whole = logExport({ head: 3, messages: [message(1, "a"), message(2, "b"), message(3, "c")], first: 1 })
    expect(whole.missing).toEqual([])
    expect(exportNote(whole).complete).toBe(true)
    const gaps = logExport({ head: 9, messages: [1, 3, 9].map((s) => message(s, "x")), first: 1 })
    expect(gaps.missing).toEqual([2, 4, 5, 6, 7, 8])
    const note = exportNote(gaps)
    expect(note.complete).toBe(false)
    expect(note.text).toBe("Downloaded, but 6 messages this app couldn’t read are missing (#2, #4, #5, #6, #7 and 1 more). Update the app and download again before closing.")
  })

  test("messages the relay dropped under its storage cap before the first it kept are said, not counted missing", () => {
    const log = logExport({ head: 12, messages: [10, 11, 12].map((s) => message(s, "x")), first: 10 })
    expect(log).toMatchObject({ missing: [], dropped: 9 })
    expect(exportNote(log)).toEqual({ text: "Log downloaded. The relay had already dropped the oldest 9 messages to stay under its storage cap.", complete: true })
    expect(exportNote({ missing: [], dropped: 1 }).text).toBe("Log downloaded. The relay had already dropped the oldest message to stay under its storage cap.")
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
