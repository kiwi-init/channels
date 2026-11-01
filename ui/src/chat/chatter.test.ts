import { describe, expect, test } from "bun:test"

import { chatterLine, chatterRuns } from "~/chat/chatter"
import type { Message, Person } from "~/model"

const NOW = 1_800_000_000_000
const general = { kind: "room", room: "general" } as const
const person = (name: string, kind: Person["kind"]): Person => ({ name, kind, owner: false, you: false, presence: "online", lastSeen: NOW, joined: NOW, messages: 0 })
const channel = { people: [person("jow", "human"), person("maya", "human"), person("atlas", "agent"), person("win", "agent"), person("pixel", "agent")], lead: "atlas" }
const say = (seq: number, from: string, text: string, more: Partial<Message> = {}): Message => ({ seq, from, at: NOW + seq, text, where: general, ...more })

describe("agents talking among themselves fold into one line for people, and nothing changes for agents", () => {
  test("a run of agent messages that aren't to a person folds; people, the lead and anything for a person break it", () => {
    const list = [
      say(1, "maya", "board as csv please"),
      say(2, "pixel", "@win DM drafts land in #general", { to: ["win"], task: 21 }),
      say(3, "win", "per place, not per room. fixing T21"),
      say(4, "pixel", "rerunning"),
      say(5, "atlas", "first-hour spec is next in line"),
      say(6, "win", "green"),
      say(7, "pixel", "maya, the export has every field", { to: ["maya"] }),
      say(8, "win", "ok"),
      say(9, "pixel", "ok"),
    ]
    const runs = chatterRuns(channel, list)
    expect([...new Set([...runs.values()].map((r) => r.run.map((m) => m.seq).join(",")))]).toEqual(["2,3,4", "8,9"])
    expect(runs.get(3)?.first).toBe(2)
    expect(runs.has(6)).toBe(false)
  })

  test("a question for you, a reply to a person, or a spec's ask never folds", () => {
    const list = [say(1, "jow", "which one?"), say(2, "win", "this one", { replyTo: 1 }), say(3, "pixel", "agreed"), say(4, "win", "needs you", { mentionsYou: true }), say(5, "pixel", "ok")]
    expect(chatterRuns(channel, list).size).toBe(0)
  })

  test("only rooms fold: a task's thread and a DM show every message", () => {
    const list = [say(1, "win", "a", { where: { kind: "task", task: 3 } }), say(2, "pixel", "b", { where: { kind: "task", task: 3 } })]
    expect(chatterRuns(channel, list).size).toBe(0)
  })

  test("the folded line says who, how many and about what", () => {
    const run = [say(2, "pixel", "T21 drafts", { task: 21 }), say(3, "win", "fixing T21 and T22"), say(4, "pixel", "ok")]
    expect(chatterLine(run, (n) => n.toUpperCase())).toBe("PIXEL, WIN · 3 messages between agents about T21, T22")
  })
})
