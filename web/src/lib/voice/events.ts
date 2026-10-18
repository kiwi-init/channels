export interface VoiceTool {
  name: string
  description: string
  parameters: { type: "object"; properties: Record<string, object>; required?: string[] }
}

export interface SessionConfig {
  instructions: string
  voice: string
  tools: VoiceTool[]
  rate: number
}

export type ClientEvent =
  | {
      type: "session.update"
      session: {
        instructions: string
        voice: string
        turn_detection: { type: "server_vad" }
        audio: { input: { format: { type: "audio/pcm"; rate: number } }; output: { format: { type: "audio/pcm"; rate: number } } }
        tools: ({ type: "function" } & VoiceTool)[]
      }
    }
  | { type: "input_audio_buffer.append"; audio: string }
  | { type: "conversation.item.create"; item: { type: "message"; role: "user" | "system"; content: { type: "input_text"; text: string }[] } }
  | { type: "conversation.item.create"; item: { type: "function_call_output"; call_id: string; output: string } }
  | { type: "conversation.item.truncate"; item_id: string; content_index: number; audio_end_ms: number }
  | { type: "response.create" }
  | { type: "response.cancel" }

export type ServerEvent =
  | { type: "session.created" }
  | { type: "session.updated" }
  | { type: "input_audio_buffer.speech_started"; item_id: string }
  | { type: "input_audio_buffer.speech_stopped"; item_id: string }
  | { type: "conversation.item.input_audio_transcription.completed"; item_id: string; transcript: string }
  | { type: "response.created"; response: { id: string } }
  | { type: "response.output_audio.delta"; response_id: string; item_id: string; delta: string }
  | { type: "response.output_audio_transcript.delta"; response_id: string; item_id: string; delta: string }
  | { type: "response.output_audio_transcript.done"; response_id: string; item_id: string }
  | { type: "response.function_call_arguments.done"; response_id: string; call_id: string; name: string; arguments: string }
  | { type: "response.done"; response: { id: string; status: string } }
  | { type: "error"; error: { type: string; code?: string; message: string } }
  | { type: "other"; name: string }

export function sessionUpdate(c: SessionConfig): ClientEvent {
  const format = { type: "audio/pcm", rate: c.rate } as const
  return {
    type: "session.update",
    session: {
      instructions: c.instructions,
      voice: c.voice,
      turn_detection: { type: "server_vad" },
      audio: { input: { format }, output: { format } },
      tools: c.tools.map((t) => ({ type: "function", ...t })),
    },
  }
}

type Fields = Record<string, unknown>

const isFields = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v)
function text(o: Fields, key: string): string | null {
  const v = o[key]
  return typeof v === "string" ? v : null
}

function strings<K extends string>(o: Fields, keys: readonly K[]): Record<K, string> | null {
  const out: Partial<Record<K, string>> = {}
  for (const k of keys) {
    const v = text(o, k)
    if (v === null) return null
    out[k] = v
  }
  return out as Record<K, string>
}

export function parseServerEvent(data: unknown): ServerEvent | null {
  if (typeof data !== "string") return null
  let raw: unknown
  try {
    raw = JSON.parse(data)
  } catch {
    // Not JSON: the socket carries nothing else we read, so the frame is dropped.
    return null
  }
  if (!isFields(raw)) return null
  const type = text(raw, "type")
  if (type === null) return null
  switch (type) {
    case "session.created":
    case "session.updated":
      return { type }
    case "input_audio_buffer.speech_started":
    case "input_audio_buffer.speech_stopped": {
      const f = strings(raw, ["item_id"])
      return f && { type, ...f }
    }
    case "conversation.item.input_audio_transcription.completed": {
      const f = strings(raw, ["item_id", "transcript"])
      return f && { type, ...f }
    }
    case "response.created": {
      const r = isFields(raw.response) ? strings(raw.response, ["id"]) : null
      return r && { type, response: r }
    }
    case "response.output_audio.delta":
    case "response.output_audio_transcript.delta": {
      const f = strings(raw, ["response_id", "item_id", "delta"])
      return f && { type, ...f }
    }
    case "response.output_audio_transcript.done": {
      const f = strings(raw, ["response_id", "item_id"])
      return f && { type, ...f }
    }
    case "response.function_call_arguments.done": {
      const f = strings(raw, ["response_id", "call_id", "name", "arguments"])
      return f && { type, ...f }
    }
    case "response.done": {
      const r = isFields(raw.response) ? strings(raw.response, ["id", "status"]) : null
      return r && { type, response: r }
    }
    case "error": {
      const e = isFields(raw.error) ? raw.error : null
      const message = e && text(e, "message")
      if (!e || message === null) return null
      const code = text(e, "code")
      return { type, error: { type: text(e, "type") ?? "error", message, ...(code === null ? {} : { code }) } }
    }
    default:
      return { type: "other", name: type }
  }
}
