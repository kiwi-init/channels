import { describe, expect, test } from "bun:test"
import type { Person } from "~/model"
import { roomPeople, seatRoot } from "~/names"

const person = (name: string, more: Partial<Person> = {}): Person => ({ name, kind: "human", owner: false, you: false, presence: "online", ...more })

const people = [person("jow", { owner: true }), person("jow-2", { seatOf: "jow" }), person("tia"), person("tia-2", { seatOf: "tia" }), person("ana", { kind: "agent" })]

describe("a private room's picker shows each person once, whatever devices they're on (T1046)", () => {
  test("a person's other devices fold into them, and the devices' own seats point at the person", () => {
    const channel = { you: "jow", people: people.map((p) => (p.name === "jow" ? { ...p, you: true } : p)) }
    expect(roomPeople(channel).map((p) => p.name)).toEqual(["tia", "ana"])
    expect(seatRoot(channel, "tia-2")).toBe("tia")
    expect(seatRoot(channel, "ana")).toBe("ana")
  })

  test("from a phone, the person's own desktop seat isn't offered as someone else", () => {
    const channel = { you: "jow-2", people: people.map((p) => (p.name === "jow-2" ? { ...p, you: true } : p)) }
    expect(roomPeople(channel).map((p) => p.name)).toEqual(["tia", "ana"])
    expect(seatRoot(channel, channel.you)).toBe("jow")
  })
})
