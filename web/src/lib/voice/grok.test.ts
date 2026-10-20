import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

import bargeIn from "./fixtures/barge-in.json"
import errors from "./fixtures/error.json"
import toolCall from "./fixtures/tool-call.json"
import turn from "./fixtures/turn.json"
import { parseServerEvent } from "./events"
import { connectGrokVoice, type GrokVoice, type OpenSocket, type VoiceCall, type VoiceSocket } from "./grok"
import { base64ToPcm, floatToPcm, pcmToBase64 } from "./pcm"

class FakeSocket implements VoiceSocket {
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  sent: Record<string, unknown>[] = []
  closed: number | null = null
  constructor(
    readonly url: string,
    readonly protocols: string[]
  ) {}
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close(code?: number) {
    this.closed = code ?? 1005
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  replay(events: object[]) {
    for (const e of events) this.onmessage?.({ data: JSON.stringify(e) })
  }
  types() {
    return this.sent.map((e) => e.type)
  }
}

interface Heard {
  status: string[]
  heard: string[]
  saying: string[]
  said: string[]
  calls: VoiceCall[]
  played: [string, number[]][]
  interrupted: number
  failed: string[]
}

function session(playing: { itemId: string; playedMs: number } | null = null) {
  let socket: FakeSocket | null = null
  const open: OpenSocket = (url, protocols) => (socket = new FakeSocket(url, protocols))
  const got: Heard = { status: [], heard: [], saying: [], said: [], calls: [], played: [], interrupted: 0, failed: [] }
  let now = playing
  const voice: GrokVoice = connectGrokVoice({
    token: "eph_abc",
    instructions: "You are Kiwi's voice in the channel.",
    tools: [{ name: "open_tasks", description: "The open tasks", parameters: { type: "object", properties: { state: { type: "string" } } } }],
    open,
    playback: {
      play: (itemId, pcm) => {
        got.played.push([itemId, [...pcm]])
        now = { itemId, playedMs: 420.7 }
      },
      stop: () => {
        const was = now
        now = null
        return was
      },
    },
    on: {
      status: (s, why) => got.status.push(why ? `${s}: ${why}` : s),
      heard: (t) => got.heard.push(t),
      saying: (t) => got.saying.push(t),
      said: (t) => got.said.push(t),
      call: (c) => got.calls.push(c),
      interrupted: () => got.interrupted++,
      failed: (e) => got.failed.push(`${e.code ?? e.type}: ${e.message}`),
    },
  })
  return { ws: socket!, voice, got }
}

describe("Grok Voice: connecting", () => {
  test("the token rides in the subprotocol, never in the URL, and the model is named", () => {
    const { ws } = session()
    expect(ws.url).toBe("wss://api.x.ai/v1/realtime?model=grok-voice-latest")
    expect(ws.protocols).toEqual(["xai-client-secret.eph_abc"])
    expect(ws.url).not.toContain("eph_abc")
  })

  test("on open it configures the session: server VAD, 24 kHz PCM both ways, the tools as functions", () => {
    const { ws } = session()
    ws.open()
    expect(ws.sent).toEqual([
      {
        type: "session.update",
        session: {
          instructions: "You are Kiwi's voice in the channel.",
          voice: "Eve",
          turn_detection: { type: "server_vad" },
          audio: { input: { format: { type: "audio/pcm", rate: 24000 } }, output: { format: { type: "audio/pcm", rate: 24000 } } },
          tools: [{ type: "function", name: "open_tasks", description: "The open tasks", parameters: { type: "object", properties: { state: { type: "string" } } } }],
        },
      },
    ])
  })

  test("live once the session takes the config; nothing is sent before the socket opens", () => {
    const { ws, voice, got } = session()
    voice.tell("hello")
    expect(ws.sent).toEqual([])
    ws.open()
    ws.replay(turn.slice(0, 3))
    expect(got.status).toEqual(["connecting", "live"])
  })

  test("a socket that never opens says it couldn't reach Grok Voice; a live one that drops says it hung up", () => {
    const a = session()
    a.ws.onclose?.({ code: 1006, reason: "" })
    expect(a.got.status).toEqual(["connecting", "closed: Couldn’t reach Grok Voice"])
    const b = session()
    b.ws.open()
    b.ws.replay(turn.slice(0, 3))
    b.ws.onclose?.({ code: 1011, reason: "" })
    expect(b.got.status.at(-1)).toBe("closed: Grok Voice hung up")
  })

  test("close ends it cleanly and stops what's playing", () => {
    const { ws, voice, got } = session({ itemId: "msg_1", playedMs: 10 })
    ws.open()
    voice.close()
    expect(ws.closed).toBe(1000)
    ws.onclose?.({ code: 1000, reason: "" })
    expect(got.status.at(-1)).toBe("closed")
  })
})

describe("Grok Voice: a spoken turn (turn.json)", () => {
  test("hears the person, plays the answer's audio in order and says its words", () => {
    const { ws, got } = session()
    ws.open()
    ws.replay(turn)
    expect(got.heard).toEqual(["What's open on the board?"])
    expect(got.played).toEqual([
      ["msg_008", [0, 1000, -1000, 32767]],
      ["msg_008", [-32768, 0, 0, 12]],
    ])
    expect(got.saying).toEqual(["Three tasks ", "Three tasks are open."])
    expect(got.said).toEqual(["Three tasks are open."])
    expect(got.interrupted).toBe(0)
  })

  test("the person's speech starting with nothing playing interrupts nothing", () => {
    const { ws, got } = session()
    ws.open()
    ws.replay(turn)
    expect(ws.types()).toEqual(["session.update"])
    expect(got.interrupted).toBe(0)
  })

  test("mic audio goes up as base64 PCM16, little-endian; an empty chunk sends nothing", () => {
    const { ws, voice } = session()
    ws.open()
    voice.append(new Int16Array([1, -2, 300]))
    voice.append(new Int16Array([]))
    expect(ws.sent.slice(1)).toEqual([{ type: "input_audio_buffer.append", audio: "AQD+/ywB" }])
  })

  test("typed words are a user item and ask for an answer; a note only adds context", () => {
    const { ws, voice } = session()
    ws.open()
    voice.tell("What's open?")
    voice.note("T7 just finished.")
    expect(ws.sent.slice(1)).toEqual([
      { type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "What's open?" }] } },
      { type: "response.create" },
      { type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: "T7 just finished." }] } },
    ])
  })
})

describe("Grok Voice: barge-in (barge-in.json)", () => {
  test("the person talking over the answer stops playback, cancels the response and truncates what wasn't heard", () => {
    const { ws, got } = session()
    ws.open()
    ws.replay(bargeIn)
    expect(ws.sent.slice(1)).toEqual([{ type: "response.cancel" }, { type: "conversation.item.truncate", item_id: "msg_010", content_index: 0, audio_end_ms: 420 }])
    expect(got.interrupted).toBe(1)
    expect(got.played).toEqual([["msg_010", [0, 1000, -1000, 32767]]])
    expect(got.saying).toEqual(["The build is "])
    expect(got.said).toEqual([])
    expect(got.heard).toEqual(["Stop, pause the agents."])
  })

  test("a stop button interrupts the same way, and a later answer plays again", () => {
    const { ws, voice, got } = session()
    ws.open()
    ws.replay(bargeIn.slice(0, 5))
    voice.interrupt()
    expect(ws.types().slice(1)).toEqual(["response.cancel", "conversation.item.truncate"])
    ws.replay([
      { type: "response.done", response: { id: "resp_002", status: "cancelled" } },
      { type: "response.created", response: { id: "resp_004" } },
      { type: "response.output_audio.delta", response_id: "resp_004", item_id: "msg_020", delta: pcmToBase64(new Int16Array([5])) },
    ])
    expect(got.played.at(-1)).toEqual(["msg_020", [5]])
  })
})

describe("Grok Voice: tools (tool-call.json)", () => {
  test("each call reaches the app with parsed arguments, and the answer resumes only once every call is answered", () => {
    const { ws, voice, got } = session()
    ws.open()
    ws.replay(toolCall)
    expect(got.calls).toEqual([
      { id: "call_001", name: "open_tasks", args: { state: "open" } },
      { id: "call_002", name: "needs_you", args: {} },
    ])
    voice.answer("call_002", { items: [] })
    expect(ws.types().slice(1)).toEqual(["conversation.item.create"])
    voice.answer("call_001", { tasks: ["T7"] })
    voice.answer("call_001", { tasks: ["again"] })
    expect(ws.sent.slice(1)).toEqual([
      { type: "conversation.item.create", item: { type: "function_call_output", call_id: "call_002", output: '{"items":[]}' } },
      { type: "conversation.item.create", item: { type: "function_call_output", call_id: "call_001", output: '{"tasks":["T7"]}' } },
      { type: "response.create" },
    ])
  })

  test("calls answered before the response is done wait for it", () => {
    const { ws, voice } = session()
    ws.open()
    ws.replay(toolCall.slice(0, 6))
    voice.answer("call_001", 1)
    expect(ws.types().slice(1)).toEqual(["conversation.item.create"])
    ws.replay(toolCall.slice(6))
    voice.answer("call_002", 2)
    expect(ws.types().slice(1)).toEqual(["conversation.item.create", "conversation.item.create", "response.create"])
  })

  test("after a barge-in, a call still running is answered but doesn't start a new answer", () => {
    const { ws, voice } = session()
    ws.open()
    ws.replay(toolCall)
    voice.interrupt()
    voice.answer("call_001", "done")
    voice.answer("call_002", "done")
    expect(ws.types().slice(1)).toEqual(["conversation.item.create", "conversation.item.create"])
  })
})

describe("Grok Voice: errors (error.json)", () => {
  test("an error is reported and the session stays live; unknown and malformed events are ignored", () => {
    const { ws, got } = session()
    ws.open()
    ws.replay(errors)
    ws.onmessage?.({ data: "not json" })
    ws.onmessage?.({ data: new ArrayBuffer(4) })
    expect(got.failed).toEqual(["invalid_audio_format: Audio format not supported. Use audio/pcm, audio/pcmu, or audio/pcma."])
    expect(got.status).toEqual(["connecting", "live"])
    expect(got.played).toEqual([])
  })

  test("every fixture event parses as something", () => {
    for (const e of [...turn, ...bargeIn, ...toolCall]) expect(parseServerEvent(JSON.stringify(e))).not.toBeNull()
  })
})

describe("PCM", () => {
  test("base64 round-trips 16-bit samples", () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234])
    expect([...base64ToPcm(pcmToBase64(pcm))]).toEqual([...pcm])
  })

  test("float samples clamp to 16 bits and resample to 24 kHz", () => {
    expect([...floatToPcm(new Float32Array([0, 1, -1, 2, -2]), 24000)]).toEqual([0, 32767, -32768, 32767, -32768])
    expect(floatToPcm(new Float32Array(48000), 48000).length).toBe(24000)
    expect([...floatToPcm(new Float32Array([0, 0.5, 1, 0.5]), 12000)]).toEqual([0, 8192, 16384, 24575, 32767, 24575, 16384, 16384])
  })
})

describe("lazy", () => {
  test("nothing in the app imports the voice code statically, so it never weighs on the first load", () => {
    const src = resolve(import.meta.dir, "../..")
    const here = resolve(import.meta.dir)
    const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) ? [join(dir, n)] : []))
    const static_ = /^\s*import\s(?!type\b)(?:(?!\bimport\b)[^;])*?from\s+["']([^"']*\/voice(?:\/[^"']*)?)["']/gm
    const bad = files(src)
      .filter((f) => !f.startsWith(here))
      .flatMap((f) => [...readFileSync(f, "utf8").matchAll(static_)].map((m) => `${relative(src, f)}: ${m[1]}`))
    expect(bad).toEqual([])
  })
})
