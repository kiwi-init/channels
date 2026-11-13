import { describe, expect, test } from "bun:test"
import type { Person } from "../model.ts"
import { roomSelection } from "./room-selection.ts"

const person = (name: string, more: Partial<Person> = {}): Person => ({ name, kind: "human", owner: false, you: false, presence: "online", ...more })
const people = [
  person("viewer", { you: true }),
  person("phone", { seatOf: "viewer" }),
  person("active"),
  person("device", { seatOf: "active" }),
  person("departed", { kind: "agent", left: true }),
  person("other"),
]

describe("room settings select only visible current identities (#2388)", () => {
  test("normalizes seats, drops the viewer and departed or unknown stored names", () => {
    expect(roomSelection({ people, you: "phone" }, ["viewer", "phone", "active", "device", "departed", "unknown"])).toEqual(["active"])
  })

  test("follows incoming membership without overwriting explicit checkbox edits", () => {
    const channel = { people, you: "viewer" }
    const edits = new Map([["active", false]])
    expect(roomSelection(channel, ["viewer", "active", "other"], edits)).toEqual(["other"])
    expect(roomSelection(channel, ["viewer"], new Map([["other", true]]))).toEqual(["other"])
  })

  test("departure removes even an explicit selection; rejoin uses current membership", () => {
    const channel = { people, you: "viewer" }
    expect(roomSelection(channel, ["viewer", "departed"], new Map([["departed", true]]))).toEqual([])
    const rejoined = { ...channel, people: people.map((p) => (p.name === "departed" ? { ...p, left: false } : p)) }
    expect(roomSelection(rejoined, ["viewer", "departed"])).toEqual(["departed"])
  })
})
