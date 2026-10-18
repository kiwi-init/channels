import { describe, expect, test } from "bun:test"

import type { SendOptions } from "@kiwi/core/client.ts"
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts"
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts"

import { VOICE_TOOLS, runVoiceTool, type ToolCtx } from "./tools"

const roster: Roster = []
const ids = new Map<string, Identity>()
const log: Message[] = []
let seq = 0
async function join(name: string, kind: "human" | "agent", owner = false) {
  const id = await generateIdentity(name)
  ids.set(name, id)
  roster.push({ name, pk: id.pk, owner, at: 0, active: true, kind })
}
async function post(from: string, ev: Event | null, body = "", more: { kind?: Kind; to?: string[]; choices?: string[]; esc?: true } = {}): Promise<Message> {
  seq++
  const kind = more.kind ?? (ev ? "event" : "msg")
  const signed = await sign(ids.get(from)!, {
    v: 1 as const,
    id: String(seq),
    from,
    kind,
    body,
    ts: seq * 1000,
    ...(ev ? { ev } : {}),
    ...(more.to ? { to: more.to } : {}),
    ...(more.choices ? { choices: more.choices } : {}),
    ...(more.esc ? { esc: more.esc } : {}),
  })
  const m = { ...signed, seq, rts: seq * 1000, sigOk: await verify(signed) }
  log.push(m)
  return m
}

await join("jow", "human", true)
await join("ana", "human")
await join("wren", "agent")
await join("puma", "agent")
await post("jow", { op: "role.set", member: "puma", role: "lead" })
const smoke = await post("puma", { op: "task.add", title: "Flaky smoke", owner: "wren" })
await post("wren", { op: "task.update", task: smoke.seq, state: "doing" })
const avatars = await post("puma", { op: "task.add", title: "Glass avatars", owner: "puma", review: "jow" })
await post("puma", { op: "task.update", task: avatars.seq, state: "doing" })
await post("puma", { op: "task.update", task: avatars.seq, state: "review" })
const ask = await post("wren", null, "Merge now or after the release?", { kind: "ask", to: ["jow"], choices: ["A: now", "B: after"], esc: true })
await post("wren", null, "Anyone seen the relay logs?", { kind: "ask", to: ["ana"] })

const state = (): ChannelState => fold(log, roster)
const names: Record<string, string> = { jow: "Jow", wren: "Wren", puma: "Puma", ana: "Ana" }

function ctx(over: Partial<ToolCtx> = {}) {
  const sent: { body: string; opts: SendOptions }[] = []
  const holds: [boolean, string | undefined][] = []
  const c: ToolCtx = {
    state: state(),
    me: "jow",
    channel: "channels",
    isOwner: true,
    online: new Set(["wren"]),
    requests: [{ name: "otter", display: "Otter" }],
    nameOf: (n) => names[n] ?? n,
    send: async (body, opts) => {
      sent.push({ body, opts })
      return 900 + sent.length
    },
    hold: async (on, note) => void holds.push([on, note]),
    ...over,
  }
  return { c, sent, holds }
}

describe("voice tools: what's going on", () => {
  test("every tool is a function with a JSON schema object", () => {
    expect(VOICE_TOOLS.map((t) => t.name)).toEqual(["channel_status", "open_tasks", "needs_you", "post", "answer_ask", "hold", "enqueue_work"])
    for (const t of VOICE_TOOLS) expect(t.parameters.type).toBe("object")
  })

  test("channel_status: the lead, the agents and what they're on, and what waits on the person", async () => {
    const { c } = ctx()
    expect(await runVoiceTool("channel_status", {}, c)).toEqual({
      channel: "channels",
      lead: "Puma",
      paused: false,
      people: ["Jow", "Ana"],
      agents: [
        { name: "Wren", online: true, working_on: `T${smoke.seq} Flaky smoke`, queued: 0 },
        { name: "Puma", online: false, queued: 0 },
      ],
      open_tasks: 2,
      in_progress: 1,
      waiting_on_you: 3,
    })
  })

  test("open_tasks: newest change first, filtered by state when asked", async () => {
    const { c } = ctx()
    expect(await runVoiceTool("open_tasks", {}, c)).toEqual({
      count: 2,
      tasks: [
        { id: `T${avatars.seq}`, title: "Glass avatars", state: "in review", owner: "Puma" },
        { id: `T${smoke.seq}`, title: "Flaky smoke", state: "in progress", owner: "Wren" },
      ],
    })
    expect(await runVoiceTool("open_tasks", { state: "in progress" }, c)).toEqual({ count: 1, tasks: [{ id: `T${smoke.seq}`, title: "Flaky smoke", state: "in progress", owner: "Wren" }] })
  })

  test("needs_you: the person's questions with options, their reviews, and joins for the owner only", async () => {
    const { c } = ctx()
    expect(await runVoiceTool("needs_you", {}, c)).toEqual({
      count: 3,
      items: [
        { kind: "decision", ask: ask.seq, from: "Wren", text: "Merge now or after the release?", options: ["A: now", "B: after"] },
        { kind: "review", id: `T${avatars.seq}`, title: "Glass avatars", state: "in review", owner: "Puma" },
        { kind: "join", name: "Otter" },
      ],
    })
    const asAna = await runVoiceTool("needs_you", {}, ctx({ me: "ana", isOwner: false }).c)
    expect(asAna).toMatchObject({ count: 1, items: [{ kind: "question", text: "Anyone seen the relay logs?" }] })
  })

  test("the read tools answer from local state well under 300 ms, even on a big board", async () => {
    const big = fold(log, roster)
    for (let i = 0; i < 2000; i++) big.tasks.set(10_000 + i, { ...big.tasks.get(smoke.seq)!, id: 10_000 + i, updatedAt: i })
    const { c } = ctx({ state: big })
    for (const name of ["channel_status", "open_tasks", "needs_you"]) {
      const t0 = performance.now()
      await runVoiceTool(name, {}, c)
      expect(performance.now() - t0).toBeLessThan(300)
    }
  })
})

describe("voice tools: acting as the person", () => {
  test("post sends their words, addressed when they name someone; nobody by that name is refused", async () => {
    const { c, sent } = ctx()
    expect(await runVoiceTool("post", { text: "on my way" }, c)).toEqual({ posted: "#901" })
    expect(await runVoiceTool("post", { text: "ship it", to: "wren" }, c)).toEqual({ posted: "#902", to: "Wren" })
    expect(await runVoiceTool("post", { text: "hi", to: "Nobody" }, c)).toEqual({ error: "No one here is called Nobody." })
    expect(sent.map((s) => [s.body, s.opts])).toEqual([
      ["on my way", { kind: "msg" }],
      ["ship it", { kind: "msg", to: ["wren"] }],
    ])
  })

  test("answer_ask answers with the option it names, to the asker, as a reply to the ask", async () => {
    const { c, sent } = ctx()
    expect(await runVoiceTool("answer_ask", { ask: ask.seq, answer: "b" }, c)).toEqual({ answered: `#${ask.seq}`, with: "B: after", message: "#901" })
    expect(sent[0]).toEqual({ body: "B: after", opts: { to: ["wren"], re: [ask.seq], kind: "msg" } })
    expect(await runVoiceTool("answer_ask", { ask: 1, answer: "yes" }, c)).toEqual({ error: "#1 isn't a question waiting on Jow." })
  })

  test("hold is the owner's alone", async () => {
    const owner = ctx()
    expect(await runVoiceTool("hold", { on: true, note: "lunch" }, owner.c)).toEqual({ paused: true })
    expect(owner.holds).toEqual([[true, "lunch"]])
    expect(await runVoiceTool("hold", { on: true }, ctx({ isOwner: false, hold: undefined }).c)).toEqual({ error: "Only the channel's owner can pause the agents." })
  })

  test("enqueue_work adds a task with what they said, for the lead to hand out", async () => {
    const { c, sent } = ctx()
    expect(await runVoiceTool("enqueue_work", { title: "Make the composer taller", detail: "it's cramped when I paste logs" }, c)).toEqual({
      task: "T901",
      title: "Make the composer taller",
      for: "Puma",
    })
    expect(sent[0]!.opts).toEqual({ kind: "event", ev: { op: "task.add", title: "Make the composer taller", detail: "it's cramped when I paste logs" } })
  })

  test("a send that fails, or a tool that doesn't exist, comes back as words to say", async () => {
    const { c } = ctx({ send: () => Promise.reject(new Error("offline")) })
    expect(await runVoiceTool("post", { text: "hi" }, c)).toEqual({ error: "offline" })
    expect(await runVoiceTool("delete_everything", {}, c)).toEqual({ error: "No tool called delete_everything." })
  })
})
