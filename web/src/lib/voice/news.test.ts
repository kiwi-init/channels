import { describe, expect, test } from "bun:test"

import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts"
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts"

import { voiceNewsFeed, voiceSnapshot } from "./news"

const roster: Roster = []
const ids = new Map<string, Identity>()
const log: Message[] = []
let seq = 0

async function join(name: string, kind: "human" | "agent"): Promise<void> {
  const id = await generateIdentity(name)
  ids.set(name, id)
  roster.push({ name, pk: id.pk, owner: kind === "human", at: 0, active: true, kind })
}

async function post(from: string, body: string, more: { kind?: Kind; ev?: Event; to?: string[]; choices?: string[] } = {}): Promise<Message> {
  const id = ids.get(from)
  if (!id) throw new Error(`no identity for ${from}`)
  seq++
  const signed = await sign(id, {
    v: 1 as const,
    id: String(seq),
    from,
    kind: more.kind ?? (more.ev ? "event" : "msg"),
    body,
    ts: seq * 1000,
    ...(more.ev ? { ev: more.ev } : {}),
    ...(more.to ? { to: more.to } : {}),
    ...(more.choices ? { choices: more.choices } : {}),
  })
  const m = { ...signed, seq, rts: seq * 1000, sigOk: await verify(signed) }
  log.push(m)
  return m
}

const state = (): ChannelState => fold(log, roster)
const names: Record<string, string> = { jow: "Jow", wren: "Wren" }
const nameOf = (n: string) => names[n] ?? n

await join("jow", "human")
await join("wren", "agent")
await join("marten", "agent")

describe("what the voice is told as the channel moves", () => {
  test("a task finishing is said once, even when its digest lands after it", async () => {
    const feed = voiceNewsFeed("jow", nameOf)
    const add = await post("wren", "", { ev: { op: "task.add", title: "Copy buttons copy again", owner: "wren" } })
    expect(feed(add, state())).toBeNull()
    const done = await post("wren", "", { ev: { op: "task.update", task: add.seq, state: "done" } })
    expect(feed(done, state())).toBe(`T${add.seq} is done: Copy buttons copy again (Wren).`)
    const digest = await post("wren", `T${add.seq} done: Copy buttons copy again · Merged as #370`, { kind: "done" })
    expect(feed(digest, state())).toBeNull()
  })

  test("a digest for a task it hadn't heard about is said, clipped to one line", async () => {
    const feed = voiceNewsFeed("jow", nameOf)
    const digest = await post("marten", "T900 done: Issues become tasks\n\nMerged as #380, 3 files", { kind: "done" })
    expect(feed(digest, state())).toBe("Done: T900 done: Issues become tasks Merged as #380, 3 files")
  })

  test("a new question for the person is said with its options; one for someone else isn't", async () => {
    const feed = voiceNewsFeed("jow", nameOf)
    const ask = await post("wren", "Merge the avatars now or after the release?", { kind: "ask", to: ["jow"], choices: ["A: now", "B: after"] })
    expect(feed(ask, state())).toBe("Wren asks Jow: Merge the avatars now or after the release? Options: A: now; B: after.")
    expect(feed(ask, state())).toBeNull()
    const other = await post("wren", "Can you review #371?", { kind: "ask", to: ["marten"] })
    expect(feed(other, state())).toBeNull()
    const chat = await post("wren", "just saying hi", { to: ["jow"] })
    expect(feed(chat, state())).toBeNull()
  })

  test("CI going red is said once per check and commit; a green run says nothing", async () => {
    const feed = voiceNewsFeed("jow", nameOf)
    const red = { event: "check_run" as const, repo: "ojowwalker77/channels", name: "ci-ok", branch: "T12-grok-voice", sha: "40b18ce", conclusion: "failure", at: 1 }
    const m = await post("jow", "github", { ev: { op: "github", items: [red, { ...red, name: "build / bundles" }] } })
    expect(feed(m, state())).toBe("CI is red: ci-ok on T12-grok-voice. CI is red: build / bundles on T12-grok-voice.")
    const again = await post("jow", "github", { ev: { op: "github", items: [red] } })
    expect(feed(again, state())).toBeNull()
    const green = await post("jow", "github", { ev: { op: "github", items: [{ ...red, sha: "abc", conclusion: "success" }] } })
    expect(feed(green, state())).toBeNull()
  })
})

describe("the snapshot the voice starts from", () => {
  test("names the channel, the lead, the open tasks newest first and what waits on the person", async () => {
    const older = await post("wren", "", { ev: { op: "task.add", title: "Flaky smoke", owner: "wren" } })
    const newer = await post("marten", "", { ev: { op: "task.add", title: "Issues become tasks" } })
    await post("jow", "", { ev: { op: "role.set", member: "wren", role: "lead" } })
    const s = voiceSnapshot(state(), "jow", nameOf, "channels")
    expect(s.split("\n").slice(0, 5)).toEqual([
      "Channel: channels. You speak with Jow.",
      "Lead: Wren.",
      "Open tasks (2):",
      `- T${newer.seq} Issues become tasks (open)`,
      `- T${older.seq} Flaky smoke (open, Wren)`,
    ])
    expect(s).not.toContain("Copy buttons copy again")
    expect(s).toContain("Waiting on Jow (1):\n- Wren asks: Merge the avatars now or after the release?")
    expect(s).not.toContain("Can you review #371?")
  })

  test("a quiet channel says so", async () => {
    const empty = fold([], roster)
    expect(voiceSnapshot(empty, "jow", nameOf, "quiet")).toBe("Channel: quiet. You speak with Jow.\nNo open tasks.")
  })

  test("past eight open tasks it gives the count of the rest", async () => {
    for (let i = 0; i < 9; i++) await post("wren", "", { ev: { op: "task.add", title: `chore ${i}`, owner: "wren" } })
    const s = voiceSnapshot(state(), "jow", nameOf, "channels")
    expect(s).toContain("- T")
    expect(s).toMatch(/- and \d+ more/)
    expect(s.split("\n").filter((l) => /^- T\d+ /.test(l))).toHaveLength(8)
  })
})
