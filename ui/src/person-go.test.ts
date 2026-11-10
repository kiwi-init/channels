import { describe, expect, test } from "bun:test"

import type { Person } from "~/model"
import { navigate, startNav } from "~/nav"
import { personGo } from "~/person-go"

const person = (name: string, more: Partial<Person> = {}): Person => ({ name, kind: "human", owner: false, you: false, presence: "online", lastSeen: 0, joined: 0, messages: 0, ...more })
const channel = { you: "jow-2", people: [person("jow"), person("jow-2", { you: true, seatOf: "jow" }), person("maya"), person("maya-phone", { seatOf: "maya" }), person("atlas", { kind: "agent" })] }

describe("a click on a person opens the direct conversation with them, everywhere (T1844)", () => {
  test("a person and an agent open their direct conversation", () => {
    expect(personGo(channel, "maya")).toEqual({ to: "where", where: { kind: "dm", with: "maya" }, person: "maya" })
    expect(personGo(channel, "atlas")).toEqual({ to: "where", where: { kind: "dm", with: "atlas" }, person: "atlas" })
  })

  test("another device of a person opens the conversation with the person", () => {
    expect(personGo(channel, "maya-phone")).toEqual({ to: "where", where: { kind: "dm", with: "maya" }, person: "maya-phone" })
  })

  test("you, on this device or another of yours, open your own profile: there is no conversation with yourself", () => {
    expect(personGo(channel, "jow-2")).toEqual({ to: "modal", modal: { kind: "person", name: "jow-2" } })
    expect(personGo(channel, "jow")).toEqual({ to: "modal", modal: { kind: "person", name: "jow" } })
  })

  test("someone no longer in the list still opens the conversation that was had with them", () => {
    expect(personGo(channel, "gone")).toEqual({ to: "where", where: { kind: "dm", with: "gone" }, person: "gone" })
  })

  test("inside the conversation with them, a click on their name has nowhere else to go: it opens their profile", () => {
    const inDm = navigate(startNav("a"), personGo(channel, "maya"))
    expect(inDm.where).toEqual({ kind: "dm", with: "maya" })
    expect(inDm.modal).toBeNull()
    const again = navigate(inDm, personGo(channel, "maya"))
    expect(again.modal).toEqual({ kind: "person", name: "maya" })
    expect(again.back).toEqual(inDm.back)
    expect(navigate(inDm, personGo(channel, "atlas")).where).toEqual({ kind: "dm", with: "atlas" })
  })
})
