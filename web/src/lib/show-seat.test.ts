import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { showNote } from "./show-notes"
import { noteFor, showLabel, showSeat, type PlacedSeat } from "./show-seat"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "robot.svg", robotUrl: () => "robot.svg", robotFor: () => "blue", harnessUrl: (h: string) => `/harness/${h}.svg` }))
const { ShowSeat } = await import("@/components/needs-you")

const seat: PlacedSeat = {
  place: "rex",
  alias: "ch",
  agent: "ana",
  room: "room-1",
  server: "studio",
  session: "session:01a15963-bacc-7426-91e9-4d98757dcd0c",
  block: "block:11a15963-bacc-7426-91e9-4d98757dcd0c",
}

describe("Show on a Needs you row", () => {
  test("the button names the terminal the seat runs in", () => {
    expect(showLabel("rex")).toBe("Show in Rex")
    expect(showLabel("tmux")).toBe("Show in tmux")
    expect(showLabel("terminal")).toBe("Show in Terminal")
    expect(renderToStaticMarkup(createElement(ShowSeat, { seat }))).toContain(">Show in Rex</button>")
    expect(renderToStaticMarkup(createElement(ShowSeat, {}))).toBe("")
  })

  test("Rex says why it didn't show the seat in the words it always has, and nothing once shown", () => {
    expect(showNote("rex", { ok: true })).toBeNull()
    expect(showNote("rex", { ok: false, why: "remote-control" })).toBe("Turn on Remote Control in Rex's settings to open it.")
    expect(showNote("rex", { ok: false, why: "no-server" })).toBe("Rex isn't running on this computer.")
    expect(showNote("rex", { ok: false, why: "no-app" })).toBe("Open the Rex app to show it there.")
    expect(showNote("rex", { ok: false, why: "no-rex" })).toBe("Rex isn't installed on this computer.")
    expect(showNote("rex", { ok: false, why: "failed" })).toBe("Rex didn't open that seat.")
    expect(showNote("tmux", { ok: true })).toBeNull()
    expect(showNote("tmux", { ok: false, why: "no-app" })).toBe("No tmux client is attached: the pane is selected for when you attach.")
    expect(showNote("tmux", { ok: false, why: "no-server" })).toBe("That seat's tmux server isn't running anymore.")
    expect(showNote("tmux", { ok: false, why: "failed" })).toBe("tmux didn't show that seat.")
  })

  test("outside the desktop app there's nothing to show it with", async () => {
    expect(await showSeat(seat)).toEqual({ ok: false, why: "failed" })
  })
})

test("a Show that worked has no note, and one that didn't loads its terminal's note only then", async () => {
  expect(await noteFor("tmux", { ok: true })).toBeNull()
  expect(await noteFor("tmux", { ok: false, why: "no-app" })).toBe("No tmux client is attached: the pane is selected for when you attach.")
  expect(await noteFor("rex", { ok: false, why: "no-server" })).toBe("Rex isn't running on this computer.")
})
