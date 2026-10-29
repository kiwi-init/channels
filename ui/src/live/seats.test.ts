import { describe, expect, test } from "bun:test"
import type { PlacedSeat } from "@kiwi/core/terminals.ts"
import { seated } from "~/live/seats"
import type { Person } from "~/model"

const person = (name: string, kind: Person["kind"]): Person => ({ name, kind, owner: false, you: false, presence: "online", typing: false, lastSeen: 0, joined: 0, messages: 0 })
const hosted = (agent: string, room: string): PlacedSeat => ({ place: "hosted", alias: agent, agent, room, socket: "/tmp/kiwi", pane: "%1" })

describe("an agent running in a window here can be shown (T429)", () => {
  test("an agent of this channel with a window on this computer gets its place", () => {
    const [bot] = seated([person("bot", "agent")], [hosted("bot", "room-a")], "room-a")
    expect(bot?.seat).toBe("hosted")
  })

  test("the same name in another channel's room, or a person, gets none", () => {
    const out = seated([person("bot", "agent"), person("ana", "human")], [hosted("bot", "room-b"), hosted("ana", "room-a")], "room-a")
    expect(out.map((p) => p.seat)).toEqual([undefined, undefined])
  })
})
