import { describe, expect, test } from "bun:test"

import { asksRooms, grantsOf, mayPost, pacer, postBody, startPick } from "~/mods/rooms"

const poster = {
  name: "poster",
  state: "on",
  needs: ["post:#general", "read:ops"],
  rooms: [
    { code: "dev", room: "general" },
    { code: "ops-team", room: "ops" },
    { code: "dev", room: "secret" },
  ],
}

describe("a mod's rooms (T6837)", () => {
  test("the rooms it asks for, once each and without the #", () => {
    expect(asksRooms(["panel", "post:#general", "read:general", "read:ops", "net:x.example.com"])).toEqual(["general", "ops"])
  })

  test("it posts only into a channel's room the person picked, for a room it asked to post in", () => {
    expect(mayPost(poster, "dev", "general")).toBe(true)
    expect(mayPost(poster, "ops-team", "ops")).toBe(false)
    expect(mayPost(poster, "dev", "secret")).toBe(false)
    expect(mayPost(poster, "other", "general")).toBe(false)
    expect(mayPost({ ...poster, state: "asks" }, "dev", "general")).toBe(false)
    expect(mayPost({ ...poster, rooms: [] }, "dev", "general")).toBe(false)
    expect(mayPost(undefined, "dev", "general")).toBe(false)
  })

  test("it's told only the picked rooms it asked for, with each channel's title", () => {
    expect(grantsOf(poster, (code) => (code === "dev" ? "Dev" : null))).toEqual([
      { channel: "dev", title: "Dev", room: "general" },
      { channel: "ops-team", title: "ops-team", room: "ops" },
    ])
    expect(grantsOf({ ...poster, state: "off" }, () => null)).toEqual([])
  })

  test("a post ends with a line that says which mod sent it, and an empty one sends nothing", () => {
    expect(postBody("poster", "  Build is green  ")).toBe("Build is green\n\nvia poster")
    expect(postBody("poster", " \n ")).toBeNull()
  })

  test("the picker starts with the channel you're in ticked, for each room it has", () => {
    expect(startPick(["general", "ops", "secret"], { code: "dev", rooms: [{ id: "ops" }] })).toEqual([
      { code: "dev", room: "general" },
      { code: "dev", room: "ops" },
    ])
    expect(startPick(["general"], null)).toEqual([])
  })

  test("one post every 2 seconds per mod: a sooner one says how long to wait", () => {
    const tooSoon = pacer(2_000)
    expect(tooSoon("poster", 10_000)).toBe(0)
    expect(tooSoon("poster", 11_500)).toBe(500)
    expect(tooSoon("other", 11_500)).toBe(0)
    expect(tooSoon("poster", 12_000)).toBe(0)
  })
})
