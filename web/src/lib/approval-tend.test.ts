import { describe, expect, test } from "bun:test"

import { tendOnPush, tendOwned, type TendApi } from "./approval-tend"
import type { Watches } from "./watch"

const pinged: string[] = []
const ping = (_title: string, body: string) => pinged.push(body)

function api(over: Partial<TendApi>): TendApi {
  return {
    autoApprove: async () => [],
    requests: async () => [],
    ...over,
  }
}

describe("tendOwned", () => {
  test("autoApprove throwing still announces remaining own-computer asks", async () => {
    pinged.length = 0
    const told = new Set<string>()
    await tendOwned(
      "pk",
      "chan",
      api({
        autoApprove: async () => {
          throw new Error("relay blip")
        },
        requests: async () => [{ id: "1", name: "bot" }],
      }),
      ping,
      told
    )
    expect(pinged).toEqual(["bot asks to join"])
    expect(told.has("1")).toBe(true)
  })

  test("autoApprove returning none still announces remaining own asks", async () => {
    pinged.length = 0
    await tendOwned("pk", "chan", api({ requests: async () => [{ id: "1", name: "bot" }] }), ping, new Set())
    expect(pinged).toEqual(["bot asks to join"])
  })

  test("who was let in is announced; already-told asks are not", async () => {
    pinged.length = 0
    const told = new Set(["old"])
    await tendOwned(
      "pk",
      "chan",
      api({
        autoApprove: async () => [{ name: "bot" }, { name: "dev" }],
        requests: async () => [
          { id: "old", name: "eve" },
          { id: "new", name: "ada" },
        ],
      }),
      ping,
      told
    )
    expect(pinged).toEqual(["2 of your agents joined", "ada asks to join"])
  })

  test("requests throwing still keeps the joined note", async () => {
    pinged.length = 0
    await tendOwned(
      "pk",
      "chan",
      api({
        autoApprove: async () => [{ name: "bot" }],
        requests: async () => {
          throw new Error("blip")
        },
      }),
      ping,
      new Set()
    )
    expect(pinged).toEqual(["bot joined from your computer"])
  })
})

describe("tendOnPush", () => {
  test("stop drops a rerun queued while a pass is in flight", async () => {
    const passes: string[] = []
    let finish = () => {}
    const tend = (code: string) => {
      passes.push(code)
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    }
    const watch: Watches["watch"] = () => () => {}
    const tending = tendOnPush(["a"], watch, tend)
    tending.kick("a")
    tending.kick("a")
    tending.stop()
    finish()
    await Bun.sleep(0)
    tending.kick("a")
    await Bun.sleep(0)
    expect(passes).toEqual(["a"])
  })
})
