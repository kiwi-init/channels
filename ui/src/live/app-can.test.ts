import { describe, expect, test } from "bun:test"
import { callsServedBy } from "~/live/app-can"

describe("a newer UI asks the installed app what it serves (#1118)", () => {
  test("in a plain browser there's no app, so the UI's own calls all work", async () => {
    expect(await callsServedBy(null)).toBeNull()
  })

  test("an app from before capabilities serves none of the newer calls", async () => {
    const old = {} as Parameters<typeof callsServedBy>[0]
    expect(await callsServedBy(old)).toEqual(new Set())
  })

  test("an app that answers lists its channel calls", async () => {
    const calls = await callsServedBy({ capabilities: async () => ({ contract: "1.11.0", channelCalls: ["send", "makeRoom"] }) })
    expect(calls?.has("makeRoom")).toBe(true)
    expect(calls?.has("changeRoom")).toBe(false)
  })

  test("an app whose answer fails is treated as the oldest", async () => {
    expect(await callsServedBy({ capabilities: async () => Promise.reject(new Error("no such call")) })).toEqual(new Set())
  })
})
