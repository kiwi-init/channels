import { describe, expect, test } from "bun:test"

import { takeAgents, type ChannelAgents } from "./remove-agents"

const PK = "machine-1"

function ch(members: { pk: string; name: string; from?: { pk: string } }[], fail = new Set<string>()): ChannelAgents {
  let list = members.map((m) => ({ ...m }))
  return {
    members: async () => list,
    remove: async (pk) => {
      if (fail.has(pk)) {
        fail.delete(pk)
        throw new Error("blip")
      }
      list = list.filter((m) => m.pk !== pk)
    },
  }
}

describe("takeAgents", () => {
  test("removes members from this computer, skips others and those with no from", async () => {
    const a = ch([
      { pk: "a", name: "bot", from: { pk: PK } },
      { pk: "b", name: "dev", from: { pk: "other" } },
      { pk: "c", name: "old" },
    ])
    expect(await takeAgents(PK, [a])).toEqual({ removed: ["bot"], leftover: [] })
  })

  test("retries a failed remove; leftover stays if it fails twice", async () => {
    const once = ch([{ pk: "a", name: "bot", from: { pk: PK } }], new Set(["a"]))
    expect(await takeAgents(PK, [once])).toEqual({ removed: ["bot"], leftover: [] })

    const stuck = {
      members: async () => [{ pk: "a", name: "bot", from: { pk: PK } }],
      remove: async () => {
        throw new Error("down")
      },
    }
    expect(await takeAgents(PK, [stuck])).toEqual({ removed: [], leftover: ["bot"] })
  })

  test("members() throwing is not treated as an empty channel", async () => {
    const down: ChannelAgents = {
      members: async () => {
        throw new Error("relay blip")
      },
      remove: async () => {},
    }
    await expect(takeAgents(PK, [down])).rejects.toThrow("relay blip")
  })
})
