import { describe, expect, test } from "bun:test"

import { outside, outsiders, sealedOf, warning } from "~/chat/reach"
import type { Channel, Person } from "~/model"

const person = (name: string, more: Partial<Person> = {}): Person => ({ name, kind: "human", owner: false, you: false, presence: "online", ...more })

const channel: Pick<Channel, "rooms" | "directs" | "people" | "you"> = {
  you: "jow",
  people: [
    person("jow", { owner: true, you: true }),
    person("jow-laptop", { seatOf: "jow" }),
    person("maya"),
    person("daring-newt", { kind: "agent", display: "nova" }),
    person("win", { kind: "agent" }),
    person("gone", { left: true }),
  ],
  rooms: [
    { id: "general", name: "general", unread: 0, mentions: 0 },
    { id: "r1", name: "launch", unread: 0, mentions: 0, members: ["jow", "maya"] },
  ],
  directs: [{ with: "maya", unread: 0, last: 1, locked: true }],
}

describe("a mention outside a private conversation is caught before it's sent (T2627)", () => {
  test("only a private room and a sealed DM are sealed; an open room, an agent's DM and a task thread aren't", () => {
    expect(sealedOf(channel, { kind: "room", room: "r1" })).toEqual({ kind: "room", room: "r1", inside: ["jow", "maya"] })
    expect(sealedOf(channel, { kind: "room", room: "general" })).toBeNull()
    expect(sealedOf(channel, { kind: "dm", with: "maya" })).toEqual({ kind: "dm", inside: ["jow", "maya"] })
    expect(sealedOf(channel, { kind: "dm", with: "win" })).toBeNull()
    expect(sealedOf(channel, { kind: "task", task: 7 })).toBeNull()
  })

  test("names who's mentioned but outside, once each, and never a member, one of your own devices or someone who left", () => {
    const room = sealedOf(channel, { kind: "room", room: "r1" })
    expect(outsiders(channel, room, "@daring-newt and @maya, see @daring-newt's note; @jow-laptop @gone").map((p) => p.name)).toEqual(["daring-newt"])
    expect(outsiders(channel, room, "@maya only")).toEqual([])
    expect(outsiders(channel, null, "@daring-newt")).toEqual([])
    expect(outside(channel, room, { name: "win" })).toBe(true)
    expect(outside(channel, room, { name: "jow-laptop" })).toBe(false)
  })

  test("says it by nickname: a room says they won't see it, a DM only that they can't", () => {
    const nova = channel.people.filter((p) => p.name === "daring-newt")
    const both = channel.people.filter((p) => p.name === "daring-newt" || p.name === "win")
    expect(warning({ kind: "room", room: "r1", inside: [] }, nova)).toBe("nova isn't in this room, so they won't see this.")
    expect(warning({ kind: "room", room: "r1", inside: [] }, both)).toBe("nova and win aren't in this room, so they won't see this.")
    expect(warning({ kind: "dm", inside: [] }, nova)).toBe("nova can't see this DM.")
  })
})
