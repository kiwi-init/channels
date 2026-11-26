import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import type { UpOutcome } from "@kiwi/core/up-outcome.ts"
import { byChannel, checkedSeats, PickerBody, picksOf, seatKey, type PickerLoad } from "~/shell/back-picker"

const SEATS: UpOutcome[] = [
  { channel: "kiwi", handle: "atlas", folder: "/w/kiwi", result: "planned", why: "kiwi up --seat atlas -c kiwi", before: true },
  { channel: "site", handle: "scout", folder: "/w/site", result: "planned", why: "kiwi up --seat scout -c site", before: true },
  { channel: "kiwi", handle: "win", folder: "/w/kiwi", result: "planned", why: "kiwi up --seat win -c kiwi", before: true },
  { channel: "kiwi", handle: "lead", folder: "/w/kiwi", result: "running", why: "its session is still running", before: true },
  { channel: "kiwi", handle: "sage", folder: "/w/kiwi", result: "skipped", why: "kiwi up doesn't restore codex seats yet", skip: "unsupported", before: true },
]

const body = (load: PickerLoad, off: ReadonlySet<string> = new Set()) =>
  renderToStaticMarkup(<PickerBody load={load} off={off} onToggle={() => {}} onRetry={() => {}} onCopy={() => {}} />)

describe("Bring them back picker (spec #18549)", () => {
  test("groups seats by channel in the order the plan lists them", () => {
    expect(byChannel(SEATS).map(([channel, list]) => [channel, list.map((s) => s.handle)])).toEqual([
      ["kiwi", ["atlas", "win", "lead", "sage"]],
      ["site", ["scout"]],
    ])
  })

  test("every startable agent is checked by default, and only startable ones are", () => {
    expect(picksOf(checkedSeats(SEATS, new Set()))).toEqual([
      { channel: "kiwi", handle: "atlas" },
      { channel: "site", handle: "scout" },
      { channel: "kiwi", handle: "win" },
    ])
    const html = body({ at: "ready", choices: { seats: SEATS, tmux: true } })
    expect(html.match(/type="checkbox"/g)?.length).toBe(3)
    expect(html.match(/checked=""/g)?.length).toBe(3)
    expect(html).toContain("<legend>kiwi</legend>")
    expect(html).toContain("<legend>site</legend>")
    expect(html).toContain("Already running")
    expect(html).toContain("Can&#x27;t start from here")
  })

  test("unchecking an agent leaves it out of what starts", () => {
    const off = new Set([seatKey({ channel: "kiwi", handle: "win" })])
    expect(picksOf(checkedSeats(SEATS, off))).toEqual([
      { channel: "kiwi", handle: "atlas" },
      { channel: "site", handle: "scout" },
    ])
    expect(body({ at: "ready", choices: { seats: SEATS, tmux: true } }, off).match(/checked=""/g)?.length).toBe(2)
  })

  test("a plan that failed shows its error and a retry, never an empty list", () => {
    const html = body({ at: "failed", why: "kiwi up didn't say which agents this computer has" })
    expect(html).toContain('role="alert"')
    expect(html).toContain("Couldn&#x27;t read this computer&#x27;s agents: kiwi up didn&#x27;t say which agents this computer has")
    expect(html).toContain("Try again")
    expect(html).not.toContain("No agents on this computer")
    expect(html).not.toContain("checkbox")
  })

  test("without tmux it says so first, and shows a command to copy for each checked agent", () => {
    const off = new Set([seatKey({ channel: "site", handle: "scout" })])
    const html = body({ at: "ready", choices: { seats: SEATS, tmux: false } }, off)
    expect(html.indexOf("tmux isn&#x27;t installed")).toBeGreaterThan(-1)
    expect(html.indexOf("tmux isn&#x27;t installed")).toBeLessThan(html.indexOf("<fieldset"))
    expect([...html.matchAll(/<code>([^<]+)<\/code>/g)].map((m) => m[1])).toEqual(["kiwi up --seat atlas -c kiwi", "kiwi up --seat win -c kiwi"])
  })

  test("with tmux there are no commands to copy", () => {
    expect(body({ at: "ready", choices: { seats: SEATS, tmux: true } })).not.toContain("<code>")
  })
})
