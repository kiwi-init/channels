import { describe, expect, test } from "bun:test"
import { mentionNames, type Picks } from "~/chat/linked"

const people = [{ name: "trusty-panda", display: "builder" }, { name: "bright-jaguar", display: "nova" }, { name: "gentle-otter", display: "builder" }, { name: "jow" }]
const former = [{ name: "polite-toucan", display: "nova" }]

describe("composer mentions", () => {
  test("a unique nickname is typed as the nickname and sent as the handle", () => {
    const m = mentionNames([{ name: "kind-gecko", display: "gecko" }])
    expect(m.typed("kind-gecko")).toBe("gecko")
    expect(m.sent("hi @gecko, ok")).toBe("hi @kind-gecko, ok")
  })

  test("a nickname shared with someone else, or with someone who left, still shows once you pick the person", () => {
    const m = mentionNames(people, former)
    expect(m.typed("trusty-panda")).toBe("trusty-panda")
    const picks: Picks = new Map()
    expect(m.typed("trusty-panda", picks)).toBe("builder")
    expect(m.typed("bright-jaguar", picks)).toBe("nova")
    expect(m.sent("@builder and @nova look", picks)).toBe("@trusty-panda and @bright-jaguar look")
  })

  test("without a pick, a shared nickname is sent as typed", () => {
    expect(mentionNames(people, former).sent("@builder hi")).toBe("@builder hi")
  })

  test("picking a second person with the same nickname writes their handle, so neither is lost", () => {
    const m = mentionNames(people, former)
    const picks: Picks = new Map()
    expect(m.typed("trusty-panda", picks)).toBe("builder")
    expect(m.typed("gentle-otter", picks)).toBe("gentle-otter")
    expect(m.sent("@builder @gentle-otter", picks)).toBe("@trusty-panda @gentle-otter")
  })

  test("someone with no nickname, or one with markup in it, is typed by handle", () => {
    const m = mentionNames([...people, { name: "odd-one", display: "a*b" }])
    const picks: Picks = new Map()
    expect(m.typed("jow", picks)).toBe("jow")
    expect(m.typed("odd-one", picks)).toBe("odd-one")
    expect(picks.size).toBe(0)
  })

  test("a picked nickname inside a longer word or code isn't swapped", () => {
    const m = mentionNames(people, former)
    const picks: Picks = new Map([["builder", "trusty-panda"]])
    expect(m.sent("@builders and `@builder`", picks)).toBe("@builders and `@builder`")
  })
})
