import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test"

void mock.module("~/live/prefs", () => ({ ownPrefs: () => ({ notify: "mentions" }) }))

const { chime } = await import("~/live/alerts")

type Played = { elements: number; started: number; resumes: number }

let played: Played
let resume: () => Promise<void>
let at = 1_000_000

const globals = globalThis as unknown as Record<string, unknown>
const saved = { document: globals["document"], Audio: globals["Audio"], AudioContext: globals["AudioContext"], fetch: globals["fetch"] }

function shell(name: string): void {
  globals["document"] = { documentElement: { dataset: { shell: name } } }
}

function ring(): Promise<void> {
  at += 10_000
  setSystemTime(new Date(at))
  chime()
  return new Promise((done) => setTimeout(done, 10))
}

beforeEach(() => {
  played = { elements: 0, started: 0, resumes: 0 }
  resume = () => Promise.resolve()
  globals["Audio"] = class {
    currentTime = 0
    constructor() {
      played.elements++
    }
    play(): Promise<void> {
      return Promise.resolve()
    }
  }
  globals["AudioContext"] = class {
    destination = {}
    resume(): Promise<void> {
      played.resumes++
      return resume()
    }
    decodeAudioData(): Promise<object> {
      return Promise.resolve({})
    }
    createBufferSource(): object {
      return { buffer: null, connect: () => {}, start: () => void played.started++ }
    }
  }
  globals["fetch"] = () => Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
})

afterEach(() => {
  setSystemTime()
  for (const [name, value] of Object.entries(saved)) globals[name] = value
})

describe("the Needs-you chime (#1278)", () => {
  test("on Linux it plays through WebAudio and never makes an <audio> element, which crashes WebKitGTK's web process without GStreamer's autoaudiosink", async () => {
    shell("linux")
    await ring()
    expect(played).toEqual({ elements: 0, started: 1, resumes: 1 })
    await ring()
    expect(played).toEqual({ elements: 0, started: 2, resumes: 2 })
  })

  test("on Linux with no audio device, the chime stays silent and the next one tries again", async () => {
    shell("linux")
    resume = () => Promise.reject(new Error("InvalidStateError: Failed to start the audio device"))
    await ring()
    await ring()
    expect(played).toEqual({ elements: 0, started: 0, resumes: 2 })
  })

  test("on a Mac it keeps playing its <audio> element", async () => {
    shell("mac")
    await ring()
    expect(played).toEqual({ elements: 1, started: 0, resumes: 0 })
  })
})
