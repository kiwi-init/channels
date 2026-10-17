import { fold } from "@mc/state.ts"

import { fixtureMessages, fixtureRoster } from "../fixtures/channel"
import { agentsNow, onlineFrom, PRESENCE_TTL, trusted } from "./agentsNow"

const NOW = Date.UTC(2026, 9, 16, 15, 0, 0)
const state = fold(fixtureMessages, fixtureRoster, NOW)

describe("agentsNow", () => {
  it("lists the active agents, not the people, with who coordinates and when each last spoke", () => {
    const list = agentsNow(state, fixtureMessages, new Map(), NOW)
    expect(list.map((a) => a.name).sort()).toEqual(["coordinator", "kiwi-browser", "merge-bus"])
    expect(list.every((a) => a.here === null)).toBe(true)
    expect(list.find((a) => a.name === "coordinator")?.coordinator).toBe(true)
    expect(list.find((a) => a.name === "merge-bus")?.lastAt).toBeGreaterThan(0)
  })

  it("shows an agent here once it has announced itself", () => {
    const online = new Map([["merge-bus", onlineFrom({ client: "listen", pk: "pk-bus", reach: "listening" }, NOW)]])
    const list = agentsNow(state, fixtureMessages, online, NOW)
    expect(list.find((a) => a.name === "merge-bus")?.here).toBe("listening")
    expect(list.find((a) => a.name === "kiwi-browser")?.here).toBeNull()
  })
})

describe("trusted presence", () => {
  const keyOf = new Map([["merge-bus", "pk-bus"]])
  const fresh = onlineFrom({ client: "listen", pk: "pk-bus", reach: "listening" }, NOW)

  it("keeps an announcement signed by the key the owner admitted, and not stale", () => {
    expect(trusted(new Map([["merge-bus", fresh]]), keyOf, NOW + 1000).size).toBe(1)
  })

  it("drops one from another key, an unsigned one, a stale one, and an unreachable one", () => {
    expect(trusted(new Map([["merge-bus", { ...fresh, pk: "pk-other" }]]), keyOf, NOW).size).toBe(0)
    expect(trusted(new Map([["merge-bus", { ...fresh, pk: undefined }]]), keyOf, NOW).size).toBe(0)
    expect(trusted(new Map([["merge-bus", fresh]]), keyOf, NOW + PRESENCE_TTL + 1).size).toBe(0)
    expect(trusted(new Map([["merge-bus", { ...fresh, reach: "unreachable" as const }]]), keyOf, NOW).size).toBe(0)
  })

  it("says a hooks-woken seat does not count as a wake path of its own", () => {
    expect(onlineFrom({ client: "daemon", wake: "hooks" }, NOW).wakes).toBe(false)
    expect(onlineFrom({ client: "daemon", wake: "opencode-api" }, NOW).wakes).toBe(true)
  })
})
