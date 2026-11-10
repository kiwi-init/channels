import { describe, expect, test } from "bun:test"
import { channelOf, keyRan, onCommand, runCommand } from "~/kit/commands"

describe("a menu item runs what its shortcut runs, once (T1851)", () => {
  test("a command reaches whoever listens, until they stop", () => {
    const got: string[] = []
    const stop = onCommand((c) => void got.push(c))
    runCommand("settings", 1_000)
    runCommand("channel-3", 2_000)
    stop()
    runCommand("find", 3_000)
    expect(got).toEqual(["settings", "channel-3"])
  })

  test("when the page's own key handler already ran it, the menu's copy of the same press is dropped", () => {
    const got: string[] = []
    const stop = onCommand((c) => void got.push(c))
    keyRan("jump", 10_000)
    runCommand("jump", 10_040)
    runCommand("sidebar", 10_050)
    runCommand("jump", 10_400)
    stop()
    expect(got).toEqual(["sidebar", "jump"])
  })

  test("⌘1 to ⌘9 name the channel by its place on the rail", () => {
    expect(channelOf("channel-1")).toBe(1)
    expect(channelOf("channel-9")).toBe(9)
    expect(channelOf("settings")).toBeNull()
  })
})
