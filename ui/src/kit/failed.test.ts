import { expect, spyOn, test } from "bun:test"

import { failure, Plain, plainly } from "~/kit/failed"

spyOn(console, "error").mockImplementation(() => {})

test("a sentence written for people is shown as it is, with nothing behind Details", () => {
  const f = failure("Couldn't create the room.", new Plain("a room called plans already exists"))
  expect(f).toEqual({ said: "Couldn't create the room. A room called plans already exists.", raw: null })
})

test("a check that throws its own words is plain once it runs inside plainly", () => {
  let caught: unknown
  try {
    plainly(() => {
      throw new Error("open the channel first")
    })
  } catch (err) {
    caught = err
  }
  expect(failure("Couldn't start the spec.", caught).said).toBe("Couldn't start the spec. Open the channel first.")
})

test("an unreachable relay says to check the connection and keeps the raw text for Details", () => {
  const f = failure("Couldn't check the invite.", new TypeError("Failed to fetch"))
  expect(f).toEqual({ said: "Couldn't check the invite. Check your connection and try again.", raw: "Failed to fetch" })
})

test("a relay refusal is said by its tag, never by its text", () => {
  const refused = Object.assign(new Error("403 Forbidden: scope members:write"), { _tag: "RelayError", tag: "Forbidden" })
  expect(failure("Couldn't create the room.", refused)).toEqual({ said: "Couldn't create the room. You aren't allowed to do that here.", raw: "403 Forbidden: scope members:write" })
})

test("anything else says to try again, unless the caller knows a better next step", () => {
  const odd = new Error("ENOSPC: no space left on device")
  expect(failure("Couldn't save the history.", odd).said).toBe("Couldn't save the history. Try again in a moment.")
  expect(failure("Couldn't change the hooks for Claude Code.", odd, { other: "Run kiwi hooks install claude in a terminal to see why." }).said).toBe(
    "Couldn't change the hooks for Claude Code. Run kiwi hooks install claude in a terminal to see why."
  )
})
