import { describe, expect, test } from "bun:test"

import type { Channel, Message, Task } from "~/model"
import { activityMarkdown } from "~/panes/activity"
import { wrote } from "~/words"

const day = new Date(2026, 9, 29, 10).getTime()
const general = { kind: "room", room: "general" } as const
const ev = (seq: number, text: string, more: Partial<Message> = {}): Message => ({ seq, from: "gentle-otter", at: day + seq * 60_000, text: wrote(text), where: general, system: true, ...more })
const task: Task = { id: 4, title: wrote("Export"), status: "doing", createdBy: "jow", createdAt: 0, updatedAt: 0, notes: [], rounds: [], history: [], archived: false }

const channel = {
  code: "c",
  title: "c",
  youOwn: true,
  you: "jow",
  repos: [],
  rooms: [],
  directs: [],
  theirs: [],
  people: [],
  nicknames: new Map([["gentle-otter", "opus-coder"]]),
  messages: [],
  tasks: [task],
  asks: [],
  connection: "live",
} as unknown as Channel

describe("Activity names agents by nickname (#1763)", () => {
  test("a run of task events links the task and says who by nickname", () => {
    const md = activityMarkdown(channel, [[ev(1, "@gentle-otter took T4", { task: 4 }), ev(2, "@gentle-otter moved T4 to review", { task: 4 })]])
    expect(md).toContain("@opus-coder moved T4 to review")
    expect(md).toContain("kiwi-task:4")
    expect(md).not.toContain("gentle-otter")
  })

  test("a run of plain events opens on the one it was opened for", () => {
    const md = activityMarkdown(channel, [[ev(1, "@gentle-otter joined"), ev(2, "@gentle-otter left")]], 1)
    expect(md).toContain("@opus-coder joined")
    expect(md).toContain("@opus-coder left")
    expect(md).not.toContain("gentle-otter")
  })

  test("a run of GitHub events", () => {
    const pr = { event: "pull_request", repo: "kiwi-init/channels", number: 9, action: "opened", url: "https://github.com/kiwi-init/channels/pull/9" }
    const md = activityMarkdown(channel, [[ev(1, "@gentle-otter opened PR #9", { github: [pr] }), ev(2, "@gentle-otter edited PR #9", { github: [{ ...pr, action: "edited" }] })]])
    expect(md).toContain("kiwi-pr:kiwi-init/channels/9")
    expect(md).not.toContain("gentle-otter")
  })
})
