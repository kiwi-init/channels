import { describe, expect, test } from "bun:test"

import type { Direct, Person } from "~/model"
import { leftDirects } from "~/shell/left-directs"

const person = (name: string, kind: Person["kind"], left = false): Person => ({ name, kind, owner: false, you: false, presence: left ? "offline" : "online", ...(left ? { left: true } : {}) })
const dm = (name: string): Direct => ({ with: name, unread: 0, last: 0 })

describe("DMs with members who left", () => {
  const channel = {
    people: [person("ana", "human"), person("lead", "agent")],
    former: [person("nova", "agent", true), person("tia", "human", true)],
    directs: [dm("ana"), dm("lead"), dm("nova"), dm("tia"), dm("gone")],
  }

  test("an agent that left is listed with the agents, a person who left with the people", () => {
    const got = leftDirects(channel, new Set(["ana", "lead"]))
    expect(got.agents.map((d) => d.with)).toEqual(["nova"])
    expect(got.people.map((d) => d.with)).toEqual(["tia", "gone"])
  })
})
