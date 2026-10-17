import { AGENTS_NOW, fixtureAgents } from "../fixtures/agents"
import { byBusy, doingNow, isBusy, presenceWord, queueWord, restingWord, summarize } from "./agents"

const [coordinator, browser, bus, away, ghost] = fixtureAgents as [
  (typeof fixtureAgents)[number],
  (typeof fixtureAgents)[number],
  (typeof fixtureAgents)[number],
  (typeof fixtureAgents)[number],
  (typeof fixtureAgents)[number],
]

describe("doingNow", () => {
  it("says what the harness says it is doing, when the agent is here", () => {
    expect(doingNow(browser)).toEqual({ text: "Running Bash", busy: true })
    expect(doingNow({ ...browser, activity: { state: "working" } })).toEqual({ text: "Thinking", busy: true })
    expect(doingNow({ ...browser, activity: { state: "waiting" } })).toEqual({ text: "Waiting for a person", busy: false })
    expect(doingNow(coordinator)).toEqual({ text: "Idle", busy: false })
  })

  it("is nothing for an agent that is away, or one that says nothing", () => {
    expect(doingNow({ ...browser, here: null })).toBeNull()
    expect(doingNow(bus)).toBeNull()
  })
})

describe("isBusy and byBusy", () => {
  it("is busy when working or, with no word from the harness, when holding a task in progress", () => {
    expect(isBusy(browser)).toBe(true)
    expect(isBusy(bus)).toBe(true)
    expect(isBusy(coordinator)).toBe(false)
    expect(isBusy({ ...browser, here: null })).toBe(false)
  })

  it("puts the busy first, then those who are here, then the rest, keeping the order otherwise", () => {
    expect(byBusy([ghost, coordinator, bus, away, browser]).map((a) => a.name)).toEqual(["merge-bus", "kiwi-browser", "kiwi-sh", "ghost", "claude-3"])
  })
})

describe("what each row says", () => {
  it("is online, or away since when, or just away", () => {
    expect(presenceWord(browser, AGENTS_NOW)).toBe("online")
    expect(presenceWord(away, AGENTS_NOW)).toBe("away · 3h ago")
    expect(presenceWord(away, AGENTS_NOW, true)).toBe("away")
    expect(presenceWord(ghost, AGENTS_NOW)).toBe("away")
  })

  it("rests on how it is reached when it is doing nothing, or says it is not listening", () => {
    expect(restingWord(coordinator)).toBeNull()
    expect(restingWord({ ...coordinator, activity: undefined })).toBe("Listening")
    expect(restingWord({ ...coordinator, activity: undefined, here: "wakes" })).toBe("Wakes on new messages")
    expect(restingWord(ghost)).toBe("Not listening")
    expect(restingWord(browser)).toBeNull()
  })

  it("counts what is queued and what waits for review", () => {
    expect(queueWord(browser)).toBe("2 queued")
    expect(queueWord(bus)).toBe("1 waiting for review")
    expect(queueWord({ ...browser, load: { current: [], queued: [{ id: 1, title: "a" }], waiting: [{ id: 2, title: "b" }] } })).toBe("1 queued · 1 waiting for review")
    expect(queueWord(ghost)).toBeNull()
  })
})

describe("summarize", () => {
  it("counts who is working and names what the first two are on", () => {
    const s = summarize(fixtureAgents)
    expect(s.count).toBe("2 working")
    expect(s.line).toBe("Browser on S20 Agents strip and agent sheet · Merge bus on S17 Message menu")
    expect(s.faces.map((a) => a.name)).toEqual(["kiwi-browser", "merge-bus", "kiwi-sh", "claude-3"])
  })

  it("says how many more when three are working", () => {
    const three = [browser, bus, { ...coordinator, activity: { state: "working" as const } }]
    expect(summarize(three).line.endsWith("· 1 more")).toBe(true)
  })

  it("says who is online when nobody is working, and when nobody is", () => {
    expect(summarize([coordinator])).toMatchObject({ count: "1 online", line: "Nobody's working on a task right now" })
    expect(summarize([away, ghost])).toMatchObject({ count: "0 online", line: "No agent is online" })
  })
})
