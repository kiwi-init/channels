import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Start } from "./feed-notes.tsx"
import { DEMO_CHANNEL } from "../demo/data.ts"
import { withDepartedDms } from "../demo/departed-dms.ts"
import { dmInRoom, dmRoomOf } from "../live/dm.ts"
import type { ChannelState } from "@kiwi/core/state.ts"

const channel = withDepartedDms(DEMO_CHANNEL)

describe("DM introductory wording preserves a departed human's kind (#2389)", () => {
  for (const [name, label, human] of [
    ["maya", "maya", true],
    ["departed-human", "Mira", true],
    ["atlas", "atlas", false],
    ["scout", "scout", false],
    ["unknown-person", "Unlisted", false],
  ] as const) {
    test(`${name} has the expected human or agent wording`, () => {
      const html = renderToStaticMarkup(<Start channel={channel} where={{ kind: "dm", with: name }} />)
      expect(html).toContain(human ? `These are sent to you and ${label} alone.` : `Everyone in the channel can read your messages with ${label}.`)
    })
  }

  test("a current identity takes precedence over a historical one with the same name", () => {
    const prior = channel.former?.[0]
    if (!prior) throw new Error("missing former demo member")
    const c = { ...channel, former: [...(channel.former ?? []), { ...prior, name: "atlas", kind: "human" as const }] }
    const html = renderToStaticMarkup(<Start channel={c} where={{ kind: "dm", with: "atlas" }} />)
    expect(html).toContain("Everyone in the channel can read your messages with atlas.")
  })

  test("posting classification stays current-only; a departed human's existing room is still found", () => {
    expect(["maya", "departed-human", "atlas", "scout", "unknown-person"].map((name) => dmInRoom(channel, name))).toEqual([true, false, false, false, false])
    const members = new Map([
      ["jow", { name: "jow", pk: "pk-jow", kind: "human" as const, active: true, owner: true }],
      ["departed-human", { name: "departed-human", pk: "pk-human", kind: "human" as const, active: false, owner: false }],
    ])
    const state: Pick<ChannelState, "rooms" | "members"> = {
      members,
      rooms: new Map([
        [
          "historical",
          {
            id: "historical",
            name: "",
            createdBy: null,
            at: 0,
            dm: true,
            members: [
              { name: "jow", pk: "pk-jow" },
              { name: "departed-human", pk: "pk-human" },
            ],
          },
        ],
      ]),
    }
    expect(dmRoomOf(state, "jow", "departed-human")).toBe("historical")
    expect(dmRoomOf(state, "jow", "unknown-person")).toBeUndefined()
  })
})
