import type { Message } from "@kiwi/core/protocol.ts"
import type { ChannelState } from "@kiwi/core/state.ts"

import { connectGrokVoice, type GrokVoice, type OpenSocket, type Playback } from "./grok"
import { voiceNewsFeed, voiceSnapshot } from "./news"
import { VOICE_TOOLS, runVoiceTool, type ToolCtx, type Verbs } from "./tools"

export type TalkStatus = "off" | "connecting" | "live"

export interface TalkView {
  status: TalkStatus
  heard: string
  saying: string
  error: string | null
}

export interface Mic {
  stop(): void
}

export interface TalkDeps {
  token: (roomId: string) => Promise<{ token: string; expiresAt: number }>
  mic: (onPcm: (pcm: Int16Array) => void) => Promise<Mic>
  speaker: () => Playback & { close(): void }
  open?: OpenSocket
}

export interface TalkChannel {
  roomId: string
  channel: string
  me: string
  nameOf: (name: string) => string
  state: ChannelState
  messages: Message[]
  tools?: ToolCtx
}

export interface Talk {
  view(): TalkView
  subscribe(listener: () => void): () => void
  start(c: TalkChannel): Promise<void>
  stop(): void
  leave(roomId: string): void
  seen(messages: Message[], state: ChannelState, roomId: string): void
  use(tools: ToolCtx, roomId: string): void
}

const STOP_AFTER_MS = 2500
const NEWS = "Channel news. Say it when it fits, in a sentence, without cutting the person off:"

export function instructionsFor(c: TalkChannel): string {
  return [
    `You are the voice of a Kiwi channel, where people and AI agents work together. You talk with ${c.nameOf(c.me)}.`,
    "Speak briefly and plainly, like a teammate on a call. Say task numbers as T and the number.",
    c.tools
      ? [
          "Look things up with your tools rather than guessing. Before you post, answer a question or add a task, read back exactly what you'll do and wait for a yes.",
          "Three words are verbs. “Yes” with nothing pending: call yes with confirmed false and say its readback word for word; when they say yes to it, call yes with confirmed true. “Hold”: the same with hold. “Stop”: the same with stop, which ends the call.",
        ].join(" ")
      : "You can tell them what's going on in the channel. You can't post, approve or change anything: when they ask for that, say they can type it in the composer.",
    "System messages that start with “Channel news” are things that just happened; mention them when it fits.",
    "",
    "Where things stand:",
    voiceSnapshot(c.state, c.me, c.nameOf, c.channel),
  ].join("\n")
}

function reason(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  if (/no consent/.test(text)) return "Turn voice on for this channel in Settings → Voice."
  if (/no voice key/.test(text)) return "Add an xAI key in Settings → Voice."
  if (/NotAllowedError|Permission|denied/i.test(text)) return "Channels can’t use the microphone. Allow it in System Settings → Privacy & Security → Microphone."
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")
}

export function createTalk(deps: TalkDeps): Talk {
  let view: TalkView = { status: "off", heard: "", saying: "", error: null }
  const listeners = new Set<() => void>()
  let session: { voice: GrokVoice; mic: Mic | null; speaker: Playback & { close(): void }; news: (m: Message, s: ChannelState) => string | null; after: number } | null = null
  let run = 0
  let room: string | null = null
  let tools: ToolCtx | null = null
  let verbs: Verbs = { pending: null }

  const set = (next: Partial<TalkView>) => {
    view = { ...view, ...next }
    for (const l of listeners) l()
  }
  const end = (error: string | null) => {
    run++
    room = null
    const s = session
    session = null
    s?.mic?.stop()
    s?.voice.close()
    s?.speaker.close()
    set({ status: "off", saying: "", error })
  }

  return {
    view: () => view,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    async start(c) {
      if (session || view.status !== "off") return
      const mine = ++run
      room = c.roomId
      tools = c.tools ?? null
      verbs = { pending: null }
      set({ status: "connecting", heard: "", saying: "", error: null })
      try {
        const { token } = await deps.token(c.roomId)
        if (mine !== run) return
        const speaker = deps.speaker()
        const voice = connectGrokVoice({
          token,
          instructions: instructionsFor(c),
          playback: speaker,
          open: deps.open,
          tools: c.tools ? VOICE_TOOLS : [],
          on: {
            status: (s, why) => {
              if (mine !== run) return
              if (s === "live") set({ status: "live" })
              if (s === "closed") end(why ?? null)
            },
            heard: (text) => mine === run && set({ heard: text, saying: "" }),
            saying: (text) => mine === run && set({ saying: text }),
            said: (text) => mine === run && set({ saying: text }),
            interrupted: () => mine === run && set({ saying: "" }),
            call: (call) => {
              const ctx = tools
              if (mine !== run || !ctx) return
              const endCall = () => setTimeout(() => mine === run && end(null), STOP_AFTER_MS)
              void runVoiceTool(call.name, call.args, { ...ctx, endCall }, verbs).then((out) => mine === run && voice.answer(call.id, out))
            },
            failed: (e) => mine === run && set({ error: e.message }),
          },
        })
        session = { voice, mic: null, speaker, news: voiceNewsFeed(c.me, c.nameOf), after: c.messages.at(-1)?.seq ?? 0 }
        const mic = await deps.mic((pcm) => voice.append(pcm))
        if (mine !== run || !session) {
          mic.stop()
          return
        }
        session.mic = mic
      } catch (err) {
        if (mine === run) end(reason(err))
      }
    },
    stop: () => end(null),
    leave(roomId) {
      if (room === roomId) end(null)
    },
    use(next, roomId) {
      if (tools && roomId === room) tools = next
    },
    seen(messages, state, roomId) {
      const s = session
      if (!s || roomId !== room) return
      for (const m of messages) {
        if (m.seq <= s.after) continue
        s.after = m.seq
        const line = s.news(m, state)
        if (line) s.voice.note(`${NEWS} ${line}`)
      }
    },
  }
}
