import { describe, expect, test } from "bun:test"

import { composerMentions, mentionText, withHandles, type Mentionable } from "./mentions"

const people: Mentionable[] = [
  { name: "nimble-jackal", label: "teamleader" },
  { name: "noble-llama", label: "claude-one" },
  { name: "radiant-marmot", label: "claude-two" },
  { name: "jow", label: "Jonatas Walker" },
  { name: "quiet-owl", label: "quiet-owl" },
]

describe("mentionText", () => {
  test("a picked agent reads as its nickname", () => {
    expect(mentionText(people[0]!, people)).toBe("teamleader")
    expect(mentionText(people[3]!, people)).toBe("Jonatas Walker")
  })

  test("falls back to the handle when the nickname doesn't name one member", () => {
    const twins = [...people, { name: "fair-tortoise", label: "teamleader" }]
    expect(mentionText(people[0]!, twins)).toBe("nimble-jackal")
    const clash = [...people, { name: "teamleader", label: "someone" }]
    expect(mentionText(people[0]!, clash)).toBe("nimble-jackal")
    expect(mentionText({ name: "a", label: "x`y" }, [])).toBe("a")
    expect(mentionText({ name: "a", label: "" }, [])).toBe("a")
  })
})

describe("withHandles", () => {
  test("turns nicknames back into handles, so routing is unchanged", () => {
    expect(withHandles("@teamleader please check", people)).toBe("@nimble-jackal please check")
    expect(withHandles("@claude-one and @claude-two, go", people)).toBe("@noble-llama and @radiant-marmot, go")
    expect(withHandles("for @Jonatas Walker.", people)).toBe("for @jow.")
  })

  test("ignores case, keeps handles and leaves the rest alone", () => {
    expect(withHandles("@TeamLeader hi", people)).toBe("@nimble-jackal hi")
    expect(withHandles("@nimble-jackal hi", people)).toBe("@nimble-jackal hi")
    expect(withHandles("mail me@teamleader or @teamleaders or @teamleader.io", people)).toBe("mail me@teamleader or @teamleaders or @teamleader.io")
    expect(withHandles("@claude hello", people)).toBe("@claude hello")
  })

  test("never rewrites code", () => {
    expect(withHandles("run `@teamleader` then @teamleader", people)).toBe("run `@teamleader` then @nimble-jackal")
    expect(withHandles("```\n@teamleader\n```", people)).toBe("```\n@teamleader\n```")
  })
})

describe("composerMentions", () => {
  test("marks each mention where it sits in the text", () => {
    expect(composerMentions("hey @teamleader, @quiet-owl", people)).toEqual([
      { at: 4, end: 15, name: "nimble-jackal" },
      { at: 17, end: 27, name: "quiet-owl" },
    ])
    expect(composerMentions("no one here", people)).toEqual([])
  })
})
