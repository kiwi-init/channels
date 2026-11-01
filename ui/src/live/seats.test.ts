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

  test("an agent in Channels' own tmux carries the command that attaches to it, for its Copy button (T428)", () => {
    const attach = "tmux -S /tmp/kiwi attach -t %1 \\; set -w window-size latest"
    const [bot] = seated([person("bot", "agent")], [{ ...hosted("bot", "room-a"), attach }], "room-a")
    expect(bot?.attach).toBe(attach)
    const [plain] = seated([person("bot", "agent")], [hosted("bot", "room-a")], "room-a")
    expect(plain && "attach" in plain).toBe(false)
  })
})
