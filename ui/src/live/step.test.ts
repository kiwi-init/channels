import { describe, expect, test } from "bun:test"

import type { Message as Wire, Step } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { stepReplyText } from "~/chat/step"
import { asksOf } from "~/live/map"

const roster: Roster = [
  { name: "jow", pk: "pk-jow", owner: true, at: 0, active: true, kind: "human", display: "Jow" },
  { name: "win", pk: "pk-win", owner: false, at: 0, active: true, kind: "agent", runs: { harness: "claude" } },
]

const step: Step = {
  why: "The auto-mode classifier blocked my edit of ~/.gitconfig-personal, so I can't apply option B myself.",
  needsPerson: "jow",
  run: ["git config --file ~/.gitconfig-personal --unset commit.gpgsign"],
  expect: "It prints nothing.",
}

const wire = {
  v: 1,
  id: "s1",
  seq: 5,
  from: "win",
  pk: "pk-win",
  sigOk: true,
  kind: "blocking",
  body: "Remove commit signing from ~/.gitconfig-personal",
  ts: 1,
  to: ["jow"],
  esc: true,
  holds: [3],
  step,
} as Wire

describe("a step card carries its how (T462, #1127)", () => {
  test("the ask keeps the step's why, who and commands, not just its title", () => {
    const { asks } = asksOf(fold([wire], roster, 0), [wire], "jow", true, [], roster, new Map())
    expect(asks).toHaveLength(1)
    expect(asks[0]).toMatchObject({ kind: "question", text: "Remove commit signing from ~/.gitconfig-personal", options: [], step })
  })

  test("a step's answer reads as Done, with its output, or as why it wasn't done", () => {
    expect(stepReplyText({ outcome: "done" })).toBe("Done")
    expect(stepReplyText({ outcome: "done", output: "unset" })).toBe("Done\n\nunset")
    expect(stepReplyText({ outcome: "cant", reason: "No access on this Mac" })).toBe("Can't do it: No access on this Mac")
    expect(stepReplyText({ outcome: "not-needed", reason: "It was already off" })).toBe("Not needed: It was already off")
  })
})
