import { describe, expect, test } from "bun:test"

import { contractOf } from "~/settings/app-since"

describe("the contract an installed app speaks", () => {
  test("an app says which contract it speaks, so the UI can hold back what an older one would drop", async () => {
    expect(await contractOf(null)).toBeNull()
    expect(await contractOf({} as Parameters<typeof contractOf>[0])).toBe("0.0.0")
    expect(await contractOf({ capabilities: async () => ({ contract: "3.5.0", channelCalls: [] }) })).toBe("3.5.0")
    expect(await contractOf({ capabilities: async () => Promise.reject(new Error("no such call")) })).toBe("0.0.0")
  })
})
