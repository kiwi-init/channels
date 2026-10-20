import { describe, expect, test } from "bun:test"

import { canStartAgents, followLaunch, followedLaunches, sawMembers, sawRequests } from "./launches"

describe("following a launch from the app that started it", () => {
  test("only a window whose kiwi has every launch method can start agents", () => {
    const w = globalThis as unknown as { window?: { kiwi?: object } }
    const was = w.window
    w.window = { kiwi: { harnesses: () => {}, seatFolders: () => {}, chooseFolder: () => {} } }
    expect(canStartAgents()).toBe(false)
    w.window = { kiwi: { harnesses: () => {}, seatFolders: () => {}, chooseFolder: () => {}, launchAgent: () => {} } }
    expect(canStartAgents()).toBe(true)
    w.window = was
  })

  test("its request, then its member, reach whoever follows that launch in that channel, and nobody else", () => {
    const seen: string[] = []
    const stop = followLaunch("code-a", "launch-1234", (s) => seen.push(`${s.stage} ${s.name}`))
    const other = followLaunch("code-b", "launch-1234", (s) => seen.push(`b ${s.stage} ${s.name}`))
    expect(followedLaunches("code-a")).toEqual(["launch-1234"])
    sawRequests("code-a", [
      { pk: "pk-other", name: "someone", launch: "launch-9999" },
      { pk: "pk-plain", name: "plain" },
      { pk: "pk-1", name: "radiant-marmot", launch: "launch-1234" },
    ])
    sawMembers("code-a", [{ pk: "pk-plain", name: "plain", active: true }])
    sawMembers("code-a", [{ pk: "pk-1", name: "radiant-marmot", active: false }])
    sawMembers("code-a", [{ pk: "pk-1", name: "radiant-marmot", active: true }])
    sawMembers("code-a", [{ pk: "pk-1", name: "radiant-marmot", active: true }])
    expect(seen).toEqual(["asked radiant-marmot", "joined radiant-marmot"])
    stop()
    other()
    expect(followedLaunches("code-a")).toEqual([])
  })

  test("a request seen while nobody follows its launch is not remembered", () => {
    const seen: string[] = []
    sawRequests("code-c", [{ pk: "pk-2", name: "late", launch: "launch-5678" }])
    const stop = followLaunch("code-c", "launch-5678", (s) => seen.push(s.stage))
    sawMembers("code-c", [{ pk: "pk-2", name: "late", active: true }])
    expect(seen).toEqual([])
    sawRequests("code-c", [{ pk: "pk-2", name: "late", launch: "launch-5678" }])
    sawMembers("code-c", [{ pk: "pk-2", name: "late", active: true }])
    expect(seen).toEqual(["asked", "joined"])
    stop()
  })
})
