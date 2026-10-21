import { describe, expect, test } from "bun:test"

import type { SendOptions } from "@kiwi/core/client.ts"
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts"
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts"

import { VOICE_TOOLS, runVoiceTool, type ToolCtx, type Verbs } from "./tools"

const say = (verbs: Verbs, text = "yes") => {
  verbs.spoke = (verbs.spoke ?? 0) + 1
  verbs.heard = [...(verbs.heard ?? []), text]
}

async function confirmed(name: string, args: Record<string, unknown>, c: ToolCtx): Promise<unknown> {
  const verbs: Verbs = { pending: null }
  await runVoiceTool(name, { ...args, confirmed: false }, c, verbs)
  say(verbs)
  return runVoiceTool(name, { ...args, confirmed: true }, c, verbs)
}

const roster: Roster = []
const ids = new Map<string, Identity>()
const log: Message[] = []
let seq = 0
async function join(name: string, kind: "human" | "agent", owner = false) {
  const id = await generateIdentity(name)
  ids.set(name, id)
  roster.push({ name, pk: id.pk, owner, at: 0, active: true, kind })
}
async function post(from: string, ev: Event | null, body = "", more: { kind?: Kind; to?: string[]; choices?: string[]; esc?: true; holds?: number[]; task?: number } = {}): Promise<Message> {
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
    ...(more.holds ? { holds: more.holds } : {}),
    ...(more.task ? { task: more.task } : {}),
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
const ask = await post("wren", null, "Merge now or after the release?", { kind: "ask", to: ["jow"], choices: ["A: now", "B: after"], esc: true, holds: [smoke.seq] })
await post("wren", null, "Anyone seen the relay logs?", { kind: "ask", to: ["ana"], task: smoke.seq })

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
    requests: [{ id: "r1", name: "otter", display: "Otter", kind: "agent", check: "waiting", code: null }],
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
    expect(VOICE_TOOLS.map((t) => t.name)).toEqual(["channel_status", "open_tasks", "needs_you", "post", "answer_ask", "yes", "hold", "stop", "enqueue_work"])
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
        { kind: "join", name: "Otter" },
        { kind: "decision", ask: ask.seq, from: "Wren", text: "Merge now or after the release?", options: ["A: now", "B: after"] },
        { kind: "review", id: `T${avatars.seq}`, title: "Glass avatars", state: "in review", owner: "Puma" },
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
    expect(await confirmed("post", { text: "on my way" }, c)).toEqual({ posted: "#901" })
    expect(await confirmed("post", { text: "ship it", to: "wren" }, c)).toEqual({ posted: "#902", to: "Wren" })
    expect(await confirmed("post", { text: "hi", to: "Nobody" }, c)).toEqual({ error: "No one here is called Nobody." })
    expect(sent.map((s) => [s.body, s.opts])).toEqual([
      ["on my way", { kind: "msg" }],
      ["ship it", { kind: "msg", to: ["wren"] }],
    ])
  })

  test("answer_ask answers with the option it names, to the asker, as a reply to the ask", async () => {
    const { c, sent } = ctx()
    expect(await confirmed("answer_ask", { ask: ask.seq, answer: "b" }, c)).toEqual({ answered: `#${ask.seq}`, with: "B: after", message: "#901" })
    expect(sent[0]).toEqual({ body: "B: after", opts: { to: ["wren"], re: [ask.seq], kind: "msg" } })
    expect(await confirmed("answer_ask", { ask: 1, answer: "yes" }, c)).toEqual({ error: "#1 isn't a question waiting on Jow." })
  })

  test("hold is the owner's alone, and only after its readback", async () => {
    const owner = ctx()
    const verbs: Verbs = { pending: null }
    expect(await runVoiceTool("hold", { on: true, note: "lunch", confirmed: true }, owner.c, verbs)).toEqual({ error: "Read it back first, then confirm." })
    expect(await runVoiceTool("hold", { on: true, note: "lunch", confirmed: false }, owner.c, verbs)).toEqual({
      readback: "Pause every agent for “lunch”? They'll stop work until you let them carry on.",
    })
    expect(owner.holds).toEqual([])
    say(verbs)
    expect(await runVoiceTool("hold", { on: true, note: "lunch", confirmed: true }, owner.c, verbs)).toEqual({ paused: true })
    expect(owner.holds).toEqual([[true, "lunch"]])
    expect(await runVoiceTool("hold", { on: true, confirmed: false }, ctx({ isOwner: false, hold: undefined }).c)).toEqual({ error: "Only the channel's owner can pause the agents." })
  })

  test("enqueue_work adds a task with what they said, for the lead to hand out", async () => {
    const { c, sent } = ctx()
    expect(await confirmed("enqueue_work", { title: "Make the composer taller", detail: "it's cramped when I paste logs" }, c)).toEqual({
      task: "T901",
      title: "Make the composer taller",
      for: "Puma",
    })
    expect(sent[0]!.opts).toEqual({ kind: "event", ev: { op: "task.add", title: "Make the composer taller", detail: "it's cramped when I paste logs" } })
  })

  test("a send that fails, or a tool that doesn't exist, comes back as words to say", async () => {
    const { c } = ctx({ send: () => Promise.reject(new Error("offline")) })
    expect(await confirmed("post", { text: "hi" }, c)).toEqual({ error: "offline" })
    expect(await runVoiceTool("delete_everything", {}, c)).toEqual({ error: "No tool called delete_everything." })
  })
})

describe("spoken verbs: yes, hold and stop act only on what was read back", () => {
  const ready = { id: "r2", name: "otter", display: "Otter", kind: "agent" as const, check: "ready" as const, code: "810857" }

  test("yes on a join reads back its code, and only a yes to that lets it in", async () => {
    const letIn: string[] = []
    const { c } = ctx({ requests: [ready], letIn: async (id) => void letIn.push(id) })
    const verbs: Verbs = { pending: null }
    expect(await runVoiceTool("yes", { confirmed: false }, c, verbs)).toEqual({ readback: "Otter wants to join. Let it in only if its terminal shows 8 1 0 8 5 7. Say yes to let it in." })
    say(verbs)
    expect(await runVoiceTool("yes", { confirmed: true }, c, verbs)).toEqual({ let_in: "Otter" })
    expect(letIn).toEqual(["r2"])
  })

  test("a join whose code isn't in yet can't be let in by voice", async () => {
    const { c } = ctx({ letIn: async () => undefined })
    const verbs: Verbs = { pending: null }
    expect(await runVoiceTool("yes", { confirmed: false }, c, verbs)).toEqual({ readback: "Otter wants to join, but its code isn't in yet." })
    expect(await runVoiceTool("yes", { confirmed: true }, c, verbs)).toEqual({ error: "Its code isn't in yet: let it in from the app once it is." })
  })

  test("yes without a readback first, or after the top item changed, does nothing and reads the new one back", async () => {
    const letIn: string[] = []
    const verbs: Verbs = { pending: null }
    expect(await runVoiceTool("yes", { confirmed: true }, ctx({ requests: [ready], letIn: async (id) => void letIn.push(id) }).c, verbs)).toMatchObject({
      error: expect.stringContaining("wasn't read back"),
    })
    await runVoiceTool("yes", { confirmed: false }, ctx({ requests: [ready], letIn: async () => undefined }).c, verbs)
    const other = { ...ready, id: "r3", display: "Badger", code: "123456" }
    expect(await runVoiceTool("yes", { confirmed: true }, ctx({ requests: [other], letIn: async (id) => void letIn.push(id) }).c, verbs)).toMatchObject({ readback: expect.stringContaining("Badger") })
    expect(letIn).toEqual([])
  })

  test("doing something else in between drops what was read back", async () => {
    const letIn: string[] = []
    const { c } = ctx({ requests: [ready], letIn: async (id) => void letIn.push(id) })
    const verbs: Verbs = { pending: null }
    await runVoiceTool("yes", { confirmed: false }, c, verbs)
    await runVoiceTool("post", { text: "one sec" }, c, verbs)
    expect(await runVoiceTool("yes", { confirmed: true }, c, verbs)).toMatchObject({ error: expect.stringContaining("wasn't read back") })
    expect(letIn).toEqual([])
  })

  test("yes on a question: a plain one is answered yes; one with options asks which", async () => {
    const plain = ctx({ me: "ana", isOwner: false, requests: [] })
    const verbs: Verbs = { pending: null }
    expect(await runVoiceTool("yes", { confirmed: false }, plain.c, verbs)).toEqual({ readback: "Wren asks: Anyone seen the relay logs? Say yes to answer yes." })
    say(verbs, "yeah, go ahead")
    expect(await runVoiceTool("yes", { confirmed: true }, plain.c, verbs)).toMatchObject({ message: "#901" })
    expect(plain.sent[0]).toMatchObject({ body: "Yes", opts: { to: ["wren"], kind: "msg" } })
    const options = ctx({ requests: [] })
    expect(await runVoiceTool("yes", { confirmed: false }, options.c)).toEqual({ readback: "Wren asks: Merge now or after the release? The options are: A: now; B: after. Which one?" })
    expect(await runVoiceTool("yes", { confirmed: true }, options.c, { pending: `ask:${ask.seq}` })).toEqual({ error: "This one has options: ask which, then use answer_ask." })
  })

  test("yes on a review approves it, once read back", async () => {
    const approved: number[] = []
    const { c } = ctx({ requests: [], state: { ...state(), openAsks: [] }, approve: async (t) => void approved.push(t.id) })
    const verbs: Verbs = { pending: null }
    expect(await runVoiceTool("yes", { confirmed: false }, c, verbs)).toEqual({ readback: `T${avatars.seq}, Glass avatars, done by Puma, is ready for your review. Say yes to approve it.` })
    say(verbs)
    expect(await runVoiceTool("yes", { confirmed: true }, c, verbs)).toEqual({ approved: `T${avatars.seq}` })
    expect(approved).toEqual([avatars.seq])
  })

  test("nothing waiting is said plainly", async () => {
    const { c } = ctx({ requests: [], state: { ...state(), openAsks: [], tasks: new Map() } })
    expect(await runVoiceTool("yes", { confirmed: false }, c)).toEqual({ readback: "Nothing is waiting on Jow." })
  })

  test("stop reads back, then ends the call", async () => {
    let ended = 0
    const { c } = ctx({ endCall: () => void ended++ })
    const verbs: Verbs = { pending: null }
    expect(await runVoiceTool("stop", { confirmed: true }, c, verbs)).toEqual({ error: "Read it back first, then confirm." })
    expect(await runVoiceTool("stop", { confirmed: false }, c, verbs)).toEqual({ readback: "End the call?" })
    say(verbs)
    expect(await runVoiceTool("stop", { confirmed: true }, c, verbs)).toEqual({ ending: true })
    expect(ended).toBe(1)
  })

  test("a confirmation the person didn't speak, or a no, is refused, whatever the model says", async () => {
    const { c, sent } = ctx()
    const verbs: Verbs = { pending: null }
    await runVoiceTool("post", { text: "ship it", confirmed: false }, c, verbs)
    expect(await runVoiceTool("post", { text: "ship it", confirmed: true }, c, verbs)).toEqual({ error: expect.stringContaining("hasn't answered the readback") })
    await runVoiceTool("post", { text: "ship it", confirmed: false }, c, verbs)
    say(verbs, "no, wait")
    expect(await runVoiceTool("post", { text: "ship it", confirmed: true }, c, verbs)).toEqual({ error: "The person didn't say yes to the readback." })
    await runVoiceTool("post", { text: "ship it", confirmed: false }, c, verbs)
    say(verbs)
    expect(await runVoiceTool("post", { text: "ship everything", confirmed: true }, c, verbs)).toEqual({ error: "Read it back first, then confirm." })
    expect(sent).toEqual([])
  })
})
