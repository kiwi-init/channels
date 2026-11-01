import { afterAll, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test"

let snoozeUntil: number | null = null
let plays = 0
void mock.module("~/live/prefs", () => ({ ownPrefs: () => ({ notify: "mentions", snoozeUntil, quiet: { on: false, from: 0, to: 0 } }) }))

const { chime } = await import("~/live/alerts")

type Played = { elements: number; contexts: number; decodes: number; resumes: number; started: number }

const played: Played = { elements: 0, contexts: 0, decodes: 0, resumes: 0, started: 0 }
let decodeAudioData: () => Promise<object> = () => Promise.resolve({})
let resume: () => Promise<void> = () => Promise.resolve()
let at = 1_000_000

const SWAPPED = ["document", "Audio", "AudioContext", "fetch"] as const
const saved = new Map(SWAPPED.map((name) => [name, Reflect.get(globalThis, name)]))

const shell = (name: string): void => void Reflect.set(globalThis, "document", { documentElement: { dataset: { shell: name } } })

function ring(): Promise<void> {
  at += 10_000
  setSystemTime(new Date(at))
  chime()
  return new Promise((done) => setTimeout(done, 10))
}

Reflect.set(
  globalThis,
  "Audio",
  class {
    currentTime = 0
    constructor() {
      played.elements++
    }
    play(): Promise<void> {
      plays++
      return Promise.resolve()
    }
  }
)
Reflect.set(
  globalThis,
  "AudioContext",
  class {
    destination = {}
    constructor() {
      played.contexts++
    }
    resume(): Promise<void> {
      played.resumes++
      return resume()
    }
    decodeAudioData(): Promise<object> {
      played.decodes++
      return decodeAudioData()
    }
    createBufferSource(): object {
      return { buffer: null, connect: () => {}, start: () => void played.started++ }
    }
  }
)
Reflect.set(globalThis, "fetch", () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }))

beforeEach(() => {
  Object.assign(played, { elements: 0, contexts: 0, decodes: 0, resumes: 0, started: 0 })
  decodeAudioData = () => Promise.resolve({})
  resume = () => Promise.resolve()
})

afterAll(() => {
  setSystemTime()
  for (const [name, value] of saved) Reflect.set(globalThis, name, value)
})

describe("the Needs-you chime (#1278)", () => {
  test("on Linux with no GStreamer decoder, the chime stays silent, retries the decode next time, and keeps one AudioContext", async () => {
    shell("linux")
    decodeAudioData = () => Promise.reject(new Error("EncodingError: Decoding failed"))
    await ring()
    await ring()
    await ring()
    expect(played).toEqual({ elements: 0, contexts: 1, decodes: 3, resumes: 0, started: 0 })
  })

  test("on Linux it plays through WebAudio, decoding once, and never makes an <audio> element, which crashes WebKitGTK's web process without GStreamer's autoaudiosink", async () => {
    shell("linux")
    await ring()
    await ring()
    expect(played).toEqual({ elements: 0, contexts: 0, decodes: 1, resumes: 2, started: 2 })
  })

  test("on Linux with no audio device, the chime stays silent and the next one tries again", async () => {
    shell("linux")
    resume = () => Promise.reject(new Error("InvalidStateError: Failed to start the audio device"))
    await ring()
    await ring()
    expect(played).toEqual({ elements: 0, contexts: 0, decodes: 0, resumes: 2, started: 0 })
  })

  test("on a Mac it keeps playing its <audio> element", async () => {
    shell("mac")
    await ring()
    expect(played).toEqual({ elements: 1, contexts: 0, decodes: 0, resumes: 0, started: 0 })
  })
})

describe("a paused computer stays quiet (T972)", () => {
  test("while notifications are paused the chime doesn't ring, and it rings again once the pause is over", async () => {
    shell("mac")
    const before = plays
    snoozeUntil = at + 60_000
    await ring()
    expect(plays).toBe(before)
    snoozeUntil = null
    await ring()
    expect(plays).toBe(before + 1)
  })
})
