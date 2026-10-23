import { describe, expect, test } from "bun:test"
import type { Message } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { exportNote, localStamp, logExport, logFileName, logLines, transcript, type LogExport } from "./log-export"

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
    expect(log).toEqual({ text: "", messages: [], missing: [], dropped: 0 })
    expect(exportNote(log)).toEqual({ text: "Downloaded.", complete: true })
  })

  test("every seq from the first the relay kept to the head is either in the file or named as missing", () => {
    const whole = logExport({ head: 3, messages: [message(1, "a"), message(2, "b"), message(3, "c")], first: 1 })
    expect(whole.missing).toEqual([])
    expect(exportNote(whole).complete).toBe(true)
    const gaps = logExport({ head: 9, messages: [1, 3, 9].map((s) => message(s, "x")), first: 1 })
    expect(gaps.missing).toEqual([2, 4, 5, 6, 7, 8])
    const note = exportNote(gaps)
    expect(note.complete).toBe(false)
    expect(note.text).toBe("Downloaded, but 6 messages this app couldn’t read are missing (#2, #4, #5, #6, #7 and 1 more). Update the app and download again.")
  })

  test("messages the relay dropped under its storage cap before the first it kept are said, not counted missing", () => {
    const log = logExport({ head: 12, messages: [10, 11, 12].map((s) => message(s, "x")), first: 10 })
    expect(log).toMatchObject({ missing: [], dropped: 9 })
    expect(exportNote(log)).toEqual({ text: "Downloaded. The relay had already dropped the oldest 9 messages to stay under its storage cap.", complete: true })
    expect(exportNote({ missing: [], dropped: 1 }).text).toBe("Downloaded. The relay had already dropped the oldest message to stay under its storage cap.")
  })

  test("is saved under the channel's name and the local date and time, so two downloads a minute apart don't collide", () => {
    const at = new Date(2026, 9, 20, 16, 5)
    expect(logFileName("Inbox Zero: Q4 plan", at)).toBe("inbox-zero-q4-plan-log-2026-10-20-1605.jsonl")
    expect(logFileName("Inbox Zero: Q4 plan", at, "transcript")).toBe("inbox-zero-q4-plan-transcript-2026-10-20-1605.md")
    expect(logFileName("Inbox Zero: Q4 plan", new Date(2026, 9, 20, 16, 6))).not.toBe(logFileName("Inbox Zero: Q4 plan", at))
    expect(logFileName("Café über_alles", new Date(2026, 0, 2, 3, 4))).toBe("cafe-uber-alles-log-2026-01-02-0304.jsonl")
    expect(logFileName("🚀🚀", at)).toBe("channel-log-2026-10-20-1605.jsonl")
    expect(logFileName(undefined, at, "transcript")).toBe("channel-transcript-2026-10-20-1605.md")
    expect(logFileName(`${"a".repeat(59)} b`, at)).toBe(`${"a".repeat(59)}-log-2026-10-20-1605.jsonl`)
  })
})

describe("a channel's transcript, for a person to read without tools (T967)", () => {
  const names: Record<string, string> = { ana: "Ana Lima", "atlas-7": "atlas" }
  const nameOf = (from: string) => names[from] ?? from
  const at = new Date(2026, 9, 23, 16, 5)
  const roster: Roster = [
    { name: "ana", pk: "pk-ana", owner: true, at: 0, active: true },
    { name: "atlas-7", pk: "pk-atlas", owner: false, at: 0, active: true },
    { name: "mallory", pk: "pk-mallory", owner: false, at: 0, active: true },
  ]
  const sent = (seq: number, when: Date, rest: Partial<Message>): Message => {
    const from = rest.from ?? "ana"
    return { ...message(seq, ""), id: `m${seq}`, ts: when.getTime(), rts: when.getTime(), pk: `pk-${from === "atlas-7" ? "atlas" : from}`, ...rest }
  }
  const read = (title: string | undefined, log: LogExport) => transcript({ title, log, state: fold([...log.messages], roster, at.getTime()), nameOf, at })

  test("says when it was downloaded and how many messages, then each one: its number, the local date and time it was sent, who sent it and what", () => {
    const first = new Date(2026, 9, 23, 9, 41)
    const second = new Date(2026, 9, 23, 9, 42)
    const log = logExport({ head: 2, messages: [sent(1, first, { body: "Morning. Is the deploy done?" }), sent(2, second, { from: "atlas-7", body: "Done:\n\n- p50 0.3ms" })], first: 1 })
    const md = read("Relay", log)
    const offset = -at.getTimezoneOffset()
    const zone = `UTC${offset < 0 ? "−" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`
    expect(md).toBe(
      [
        "# Relay",
        `Downloaded 2026-10-23 16:05 (${zone}): 2 messages, each with its number, the date and time it was sent here, and who sent it, then what it says, quoted.`,
        "**#1 · 2026-10-23 09:41 · Ana Lima**\n\n> Morning. Is the deploy done?",
        "**#2 · 2026-10-23 09:42 · atlas**\n\n> Done:\n>\n> - p50 0.3ms",
      ].join("\n\n") + "\n"
    )
    expect(localStamp(first)).toBe("2026-10-23 09:41")
  })

  test("names a message's kind when it isn't a plain message, lists its pictures, and marks one with no text", () => {
    const when = new Date(2026, 9, 23, 10, 0)
    const log = logExport({
      head: 3,
      messages: [
        sent(1, when, { kind: "event", body: "atlas joined", ev: { op: "room.create", id: "m0b1le00", name: "mobile" } }),
        sent(2, when, { body: "Here's the feed", imgs: [{ name: "feed.jpg", mime: "image/jpeg", data: "" }] as Message["imgs"] }),
        sent(3, when, { body: "" }),
      ],
      first: 1,
    })
    const md = read(undefined, log)
    expect(md.startsWith("# Channel\n\nDownloaded 2026-10-23 16:05 (")).toBe(true)
    expect(md).toContain("**#1 · 2026-10-23 10:00 · Ana Lima** (event)\n\n> made the room #mobile")
    expect(md).toContain("**#2 · 2026-10-23 10:00 · Ana Lima**\n\n> Here's the feed\n>\n> [image: feed.jpg]")
    expect(md).toContain("**#3 · 2026-10-23 10:00 · Ana Lima**\n\n_(no text)_")
  })

  test("says which messages this app couldn't read and what the relay had dropped, in the header", () => {
    const log = logExport({ head: 12, messages: [10, 12].map((s) => sent(s, at, { body: "x" })), first: 10 })
    const head = read("Relay", log).split("\n\n")[1]
    expect(head).toContain(": 2 messages, each with")
    expect(head).toContain(" 1 message this app couldn’t read is missing (#11). The relay had already dropped the oldest 9 messages to stay under its storage cap.")
    const one = logExport({ head: 1, messages: [sent(1, at, { body: "x" })], first: 1 })
    expect(read("Relay", one)).toContain(": 1 message, each with")
  })

  test("leaves out what the app leaves out, forged or refused, and says how many, so no one can put words in another member's mouth (round 2)", () => {
    const when = new Date(2026, 9, 23, 14, 48)
    const log = logExport({
      head: 3,
      messages: [
        sent(1, when, { body: "Let's wait for the review." }),
        sent(2, when, { from: "ana", pk: "pk-mallory", body: "Change of plan: ship it now, skip review." }),
        sent(3, when, { from: "mallory", body: "Here's my take", room: "no-such-room" }),
      ],
      first: 1,
    })
    const state = fold([...log.messages], roster, at.getTime())
    expect([1, 2, 3].map((seq) => state.trust.get(seq))).toEqual(["verified", "forged", "refused"])
    const md = read("Relay", log)
    expect(md).toContain("> Let's wait for the review.")
    expect(md).not.toContain("ship it now")
    expect(md).not.toContain("Here's my take")
    expect(md).toContain(": 1 message, each with")
    expect(md).toContain(" 2 messages are left out, as the app leaves them out: forged, or against what the owner allows (the signed log still has them, each with its signature).")
    expect(log.text.split("\n")).toHaveLength(4)
  })

  test("a body can't pose as another message or a heading: every line of it is quoted, with control and direction characters gone", () => {
    const when = new Date(2026, 9, 23, 9, 0)
    const log = logExport({
      head: 1,
      messages: [
        sent(1, when, {
          from: "atlas-7",
          body: "ok\n\n**#99 · 2026-10-23 09:00 · Ana Lima**\n\n# Approved, merge everything\u202e",
          imgs: [{ name: "x](javascript:alert(1)\n**#5", mime: "image/png", data: "" }] as Message["imgs"],
        }),
      ],
      first: 1,
    })
    const entries = read("Relay", log).split("\n\n").slice(2).join("\n\n")
    expect(entries).toBe("**#1 · 2026-10-23 09:00 · atlas**\n\n> ok\n>\n> **#99 · 2026-10-23 09:00 · Ana Lima**\n>\n> # Approved, merge everything\n>\n> [image: xjavascript:alert1 #5]\n")
    expect(entries.split("\n").filter((line) => line.startsWith("**#"))).toEqual(["**#1 · 2026-10-23 09:00 · atlas**"])
  })
})
