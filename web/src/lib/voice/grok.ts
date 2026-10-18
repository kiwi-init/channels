import { parseServerEvent, sessionUpdate, type ClientEvent, type VoiceTool } from "./events"
import { VOICE_RATE, base64ToPcm, pcmToBase64 } from "./pcm"

const GROK_VOICE_URL = "wss://api.x.ai/v1/realtime"
const GROK_VOICE_MODEL = "grok-voice-latest"
const SUBPROTOCOL = "xai-client-secret."
const OPEN = 1

export interface VoiceSocket {
  readonly readyState: number
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number; reason: string }) => void) | null
  onerror: (() => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type OpenSocket = (url: string, protocols: string[]) => VoiceSocket

export interface Playback {
  play(itemId: string, pcm: Int16Array): void
  stop(): { itemId: string; playedMs: number } | null
}

type VoiceStatus = "connecting" | "live" | "closed"

export interface VoiceCall {
  id: string
  name: string
  args: unknown
}

interface VoiceHandlers {
  status?(status: VoiceStatus, why?: string): void
  heard?(text: string): void
  saying?(soFar: string): void
  said?(text: string): void
  call?(call: VoiceCall): void
  interrupted?(): void
  failed?(error: { type: string; code?: string; message: string }): void
}

export interface VoiceOptions {
  token: string
  instructions: string
  voice?: string
  model?: string
  tools?: VoiceTool[]
  playback: Playback
  on: VoiceHandlers
  open?: OpenSocket
}

export interface GrokVoice {
  append(pcm: Int16Array): void
  tell(text: string): void
  note(text: string): void
  answer(callId: string, output: unknown): void
  interrupt(): void
  close(): void
}

const browserSocket: OpenSocket = (url, protocols) => {
  const ws = new WebSocket(url, protocols)
  const socket: VoiceSocket = {
    get readyState() {
      return ws.readyState
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
  }
  ws.onopen = () => socket.onopen?.()
  ws.onmessage = (ev) => socket.onmessage?.({ data: ev.data })
  ws.onclose = (ev) => socket.onclose?.({ code: ev.code, reason: ev.reason })
  ws.onerror = () => socket.onerror?.()
  return socket
}

function argsOf(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    // The model sent arguments that aren't JSON: the tool gets the raw string and can refuse it.
    return json
  }
}

export function connectGrokVoice(o: VoiceOptions): GrokVoice {
  const url = `${GROK_VOICE_URL}?model=${encodeURIComponent(o.model ?? GROK_VOICE_MODEL)}`
  const ws = (o.open ?? browserSocket)(url, [`${SUBPROTOCOL}${o.token}`])
  const on = o.on
  let status: VoiceStatus = "connecting"
  let responding: string | null = null
  const dropped = new Set<string>()
  const pending = new Set<string>()
  const late = new Set<string>()
  let toolsDone = false
  const transcripts = new Map<string, string>()

  const set = (next: VoiceStatus, why?: string) => {
    if (status === next) return
    status = next
    on.status?.(next, why)
  }
  const send = (ev: ClientEvent) => {
    if (ws.readyState === OPEN) ws.send(JSON.stringify(ev))
  }
  const continueAfterTools = () => {
    if (!toolsDone || pending.size) return
    toolsDone = false
    send({ type: "response.create" })
  }
  const cut = () => {
    const stopped = o.playback.stop()
    const was = responding
    if (was) {
      dropped.add(was)
      send({ type: "response.cancel" })
      responding = null
    }
    for (const id of pending) late.add(id)
    pending.clear()
    toolsDone = false
    if (stopped) send({ type: "conversation.item.truncate", item_id: stopped.itemId, content_index: 0, audio_end_ms: Math.max(0, Math.floor(stopped.playedMs)) })
    if (stopped || was) on.interrupted?.()
  }

  on.status?.("connecting")
  ws.onopen = () => send(sessionUpdate({ instructions: o.instructions, voice: o.voice ?? "Eve", tools: o.tools ?? [], rate: VOICE_RATE }))
  ws.onerror = () => undefined
  ws.onclose = (ev) => {
    o.playback.stop()
    set("closed", ev.code === 1000 ? undefined : ev.reason || (status === "connecting" ? "Couldn’t reach Grok Voice" : "Grok Voice hung up"))
  }
  ws.onmessage = (msg) => {
    const ev = parseServerEvent(msg.data)
    if (!ev) return
    switch (ev.type) {
      case "session.updated":
        set("live")
        return
      case "input_audio_buffer.speech_started":
        cut()
        return
      case "conversation.item.input_audio_transcription.completed":
        if (ev.transcript.trim()) on.heard?.(ev.transcript.trim())
        return
      case "response.created":
        responding = ev.response.id
        return
      case "response.output_audio.delta":
        if (!dropped.has(ev.response_id)) o.playback.play(ev.item_id, base64ToPcm(ev.delta))
        return
      case "response.output_audio_transcript.delta": {
        if (dropped.has(ev.response_id)) return
        const soFar = (transcripts.get(ev.item_id) ?? "") + ev.delta
        transcripts.set(ev.item_id, soFar)
        on.saying?.(soFar)
        return
      }
      case "response.output_audio_transcript.done": {
        const full = transcripts.get(ev.item_id)
        transcripts.delete(ev.item_id)
        if (full && !dropped.has(ev.response_id)) on.said?.(full)
        return
      }
      case "response.function_call_arguments.done":
        if (dropped.has(ev.response_id)) return
        pending.add(ev.call_id)
        on.call?.({ id: ev.call_id, name: ev.name, args: argsOf(ev.arguments) })
        return
      case "response.done":
        if (responding === ev.response.id) responding = null
        dropped.delete(ev.response.id)
        if (pending.size) toolsDone = true
        continueAfterTools()
        return
      case "error":
        on.failed?.(ev.error)
        return
      default:
        return
    }
  }

  return {
    append: (pcm) => {
      if (pcm.length) send({ type: "input_audio_buffer.append", audio: pcmToBase64(pcm) })
    },
    tell: (text) => {
      send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } })
      send({ type: "response.create" })
    },
    note: (text) => send({ type: "conversation.item.create", item: { type: "message", role: "system", content: [{ type: "input_text", text }] } }),
    answer: (callId, output) => {
      const waited = pending.delete(callId)
      if (!waited && !late.delete(callId)) return
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) } })
      if (waited) continueAfterTools()
    },
    interrupt: cut,
    close: () => {
      o.playback.stop()
      ws.close(1000)
    },
  }
}
