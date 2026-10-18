import { describe, expect, test } from "bun:test"

import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Kind, Message } from "@kiwi/core/protocol.ts"
import { fold, type ChannelState, type Roster } from "@kiwi/core/state.ts"

import type { OpenSocket, VoiceSocket } from "./grok"
import { createTalk, instructionsFor, type TalkChannel, type TalkDeps } from "./talk"
import type { ToolCtx } from "./tools"

class FakeSocket implements VoiceSocket {
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  sent: Record<string, unknown>[] = []
  closed = false
  constructor(readonly protocols: string[]) {}
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.closed = true
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
    this.onmessage?.({ data: JSON.stringify({ type: "session.updated" }) })
  }
  say(e: object) {
    this.onmessage?.({ data: JSON.stringify(e) })
  }
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
async function post(from: string, ev: Event | null, body = "", kind: Kind = ev ? "event" : "msg", to?: string[]): Promise<Message> {
  seq++
  const signed = await sign(ids.get(from)!, { v: 1 as const, id: String(seq), from, kind, body, ts: seq * 1000, ...(ev ? { ev } : {}), ...(to ? { to } : {}) })
  const m = { ...signed, seq, rts: seq * 1000, sigOk: await verify(signed) }
  log.push(m)
  return m
}
await join("jow", "human", true)
await join("wren", "agent")
await post("jow", { op: "voice.set", on: true })
const task = await post("wren", { op: "task.add", title: "Glass avatars", owner: "wren" })
const state = (): ChannelState => fold(log, roster)
const nameOf = (n: string) => (n === "jow" ? "Jow" : n)
const toolCtx = (posted: string[], tag = "first"): ToolCtx => ({
  state: state(),
  me: "jow",
  channel: "channels",
  isOwner: true,
  online: new Set(),
  requests: [],
  nameOf,
  send: async (body) => {
    posted.push(`${tag}: ${body}`)
    return 77
  },
})
const channel = (): TalkChannel => ({ roomId: "room-1", channel: "channels", me: "jow", nameOf, state: state(), messages: [...log] })

function rig(over: Partial<TalkDeps> = {}) {
  const sockets: FakeSocket[] = []
  const mics: { stopped: boolean; push: (pcm: Int16Array) => void }[] = []
  const tokens: string[] = []
  let spoke = 0
  let speakerClosed = false
  const open: OpenSocket = (_url, protocols) => {
    const s = new FakeSocket(protocols)
    sockets.push(s)
    return s
  }
  const deps: TalkDeps = {
    token: async (roomId) => {
      tokens.push(roomId)
      return { token: "eph_1", expiresAt: Date.now() + 600_000 }
    },
    mic: async (onPcm) => {
      const m = { stopped: false, push: onPcm }
      mics.push(m)
      return { stop: () => void (m.stopped = true) }
    },
    speaker: () => ({ play: () => void spoke++, stop: () => null, close: () => void (speakerClosed = true) }),
    open,
    ...over,
  }
  return { talk: createTalk(deps), sockets, mics, tokens, spoke: () => spoke, speakerClosed: () => speakerClosed }
}

describe("Talk to channel", () => {
  test("starts with a token for this channel, its snapshot in the instructions, and goes live", async () => {
    const r = rig()
    const seen: string[] = []
    r.talk.subscribe(() => seen.push(r.talk.view().status))
    await r.talk.start(channel())
    expect(r.tokens).toEqual(["room-1"])
    const ws = r.sockets[0]!
    expect(ws.protocols).toEqual(["xai-client-secret.eph_1"])
    ws.open()
    const update = ws.sent[0] as { session: { instructions: string } }
    expect(update.session.instructions).toContain("You talk with Jow.")
    expect(update.session.instructions).toContain(`- T${task.seq} Glass avatars (open, wren)`)
    expect(r.talk.view().status).toBe("live")
    expect(seen).toEqual(["connecting", "live"])
  })

  test("the mic goes up to Grok, what's said comes back as captions", async () => {
    const r = rig()
    await r.talk.start(channel())
    const ws = r.sockets[0]!
    ws.open()
    r.mics[0]!.push(new Int16Array([1, 2]))
    expect(ws.sent.at(-1)).toEqual({ type: "input_audio_buffer.append", audio: "AQACAA==" })
    ws.say({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "what's open?" })
    expect(r.talk.view().heard).toBe("what's open?")
    ws.say({ type: "response.created", response: { id: "r1" } })
    ws.say({ type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "a1", delta: "One task." })
    expect(r.talk.view().saying).toBe("One task.")
  })

  test("what happens in the channel while live is told as news; what came before isn't", async () => {
    const r = rig()
    await r.talk.start(channel())
    const ws = r.sockets[0]!
    ws.open()
    r.talk.seen([...log], state())
    expect(ws.sent.filter((e) => e.type === "conversation.item.create")).toEqual([])
    await post("wren", { op: "task.update", task: task.seq, state: "done" })
    r.talk.seen([...log], state())
    r.talk.seen([...log], state())
    const notes = ws.sent.filter((e) => e.type === "conversation.item.create") as { item: { role: string; content: { text: string }[] } }[]
    expect(notes).toHaveLength(1)
    expect(notes[0]!.item.role).toBe("system")
    expect(notes[0]!.item.content[0]!.text).toBe(`Channel news. Say it when it fits, in a sentence, without cutting the person off: T${task.seq} is done: Glass avatars (wren).`)
  })

  test("End stops the mic, the speaker and the call", async () => {
    const r = rig()
    await r.talk.start(channel())
    r.sockets[0]!.open()
    r.talk.stop()
    expect(r.mics[0]!.stopped).toBe(true)
    expect(r.sockets[0]!.closed).toBe(true)
    expect(r.speakerClosed()).toBe(true)
    expect(r.talk.view()).toEqual({ status: "off", heard: "", saying: "", error: null })
  })

  test("without consent or a key it says where to turn it on; a blocked mic says how to allow it", async () => {
    const noConsent = rig({ token: () => Promise.reject(new Error("Error invoking remote method 'kiwi:voice-token': Error: no consent")) })
    await noConsent.talk.start(channel())
    expect(noConsent.talk.view()).toMatchObject({ status: "off", error: "Turn voice on for this channel in Settings → Voice." })
    const noKey = rig({ token: () => Promise.reject(new Error("no voice key")) })
    await noKey.talk.start(channel())
    expect(noKey.talk.view().error).toBe("Add an xAI key in Settings → Voice.")
    const blocked = rig({ mic: () => Promise.reject(new Error("NotAllowedError: Permission denied")) })
    await blocked.talk.start(channel())
    expect(blocked.talk.view().error).toContain("Microphone")
    expect(blocked.sockets[0]!.closed).toBe(true)
  })

  test("Grok hanging up ends it with the reason; ending before the mic opens leaves no mic running", async () => {
    const r = rig()
    await r.talk.start(channel())
    r.sockets[0]!.open()
    r.sockets[0]!.onclose?.({ code: 1011, reason: "" })
    expect(r.talk.view()).toMatchObject({ status: "off", error: "Grok Voice hung up" })
    let release: (() => void) | null = null
    const slow = rig({ mic: (onPcm) => new Promise((ok) => (release = () => ok({ stop: () => void onPcm(new Int16Array()) }))) })
    const started = slow.talk.start(channel())
    await Promise.resolve()
    await Promise.resolve()
    slow.talk.stop()
    release!()
    await started
    expect(slow.talk.view().status).toBe("off")
  })

  test("stop, once read back and confirmed, ends the call after the goodbye", async () => {
    const r = rig()
    await r.talk.start({ ...channel(), tools: toolCtx([]) })
    const ws = r.sockets[0]!
    ws.open()
    const call = (id: string, args: string) => {
      ws.say({ type: "response.created", response: { id: `r-${id}` } })
      ws.say({ type: "response.function_call_arguments.done", response_id: `r-${id}`, call_id: id, name: "stop", arguments: args })
      ws.say({ type: "response.done", response: { id: `r-${id}`, status: "completed" } })
    }
    call("c1", '{"confirmed":true}')
    await new Promise((ok) => setTimeout(ok, 0))
    expect(ws.sent.some((e) => JSON.stringify(e).includes("Read it back first"))).toBe(true)
    call("c2", '{"confirmed":false}')
    call("c3", '{"confirmed":true}')
    await new Promise((ok) => setTimeout(ok, 0))
    expect(r.talk.view().status).toBe("live")
    await new Promise((ok) => setTimeout(ok, 2700))
    expect(r.talk.view().status).toBe("off")
    expect(ws.closed).toBe(true)
  })

  test("without tools it says it can't act; with them it reads back before acting", () => {
    expect(instructionsFor(channel())).toContain("You can't post, approve or change anything")
    expect(instructionsFor({ ...channel(), tools: toolCtx([]) })).toContain("read back exactly what you'll do and wait for a yes")
  })

  test("with tools, the session offers them and answers each call from the latest channel", async () => {
    const r = rig()
    const posted: string[] = []
    await r.talk.start({ ...channel(), tools: toolCtx(posted) })
    const ws = r.sockets[0]!
    ws.open()
    const update = ws.sent[0] as { session: { tools: { name: string }[] } }
    expect(update.session.tools.map((t) => t.name)).toContain("needs_you")
    r.talk.use(toolCtx(posted, "later"))
    ws.say({ type: "response.created", response: { id: "r1" } })
    ws.say({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "c1", name: "post", arguments: '{"text":"on my way"}' })
    ws.say({ type: "response.done", response: { id: "r1", status: "completed" } })
    await new Promise((ok) => setTimeout(ok, 0))
    expect(posted).toEqual(["later: on my way"])
    expect(ws.sent.slice(-2)).toEqual([{ type: "conversation.item.create", item: { type: "function_call_output", call_id: "c1", output: '{"posted":"#77"}' } }, { type: "response.create" }])
  })
})
