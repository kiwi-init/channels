import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

import { DICTATION_BYTES, DICTATION_FILES, DICTATION_PATH } from "@kiwi/core/dictation.ts"
import { pickDevice } from "./device"
import { MODEL_MB, transcriber, type SpeechWorker } from "./engine"
import { appendDictation, dictationSupported, engineLoader, openRecording, PRESS_LABEL, speechLanguage, type MicGate } from "./index"
import type { Recording } from "./recorder"
import type { ToWorker } from "./worker"
import { CACHE_NAME, downloadModel, modelReady } from "./model"
import { DictationProblem } from "./problem"

describe("appendDictation", () => {
  test("starts an empty message with the transcript", () => {
    expect(appendDictation("", "  hello there ")).toBe("hello there")
  })

  test("joins with one space after text", () => {
    expect(appendDictation("ship it", "today")).toBe("ship it today")
  })

  test("does not double a space or newline already there", () => {
    expect(appendDictation("ship it ", "today")).toBe("ship it today")
    expect(appendDictation("ship it\n", "today")).toBe("ship it\ntoday")
  })

  test("ignores an empty transcript", () => {
    expect(appendDictation("ship it", "   ")).toBe("ship it")
  })
})

describe("what dictation needs and how it reads", () => {
  test("the spoken language is the system's, as Whisper's two-letter code", () => {
    expect(speechLanguage("pt-BR")).toBe("pt")
    expect(speechLanguage("en")).toBe("en")
    expect(speechLanguage(undefined)).toBeNull()
    expect(speechLanguage("x-klingon-private")).toBeNull()
  })

  test("the mic shows only where a microphone, a worker, WebAssembly and a cache are all there", () => {
    expect(dictationSupported({} as typeof globalThis)).toBe(false)
  })

  test("the button's names, which the Linux check drives, stay what they are", () => {
    expect(PRESS_LABEL).toEqual({ idle: "Dictate", asking: "Dictate", downloading: "Downloading the dictation model", listening: "Stop dictation", transcribing: "Transcribing" })
    expect(MODEL_MB).toBe(Math.round(DICTATION_BYTES / 1e6))
  })

  test("WebGPU only from a real GPU; a software adapter, none, or an error is the CPU path", async () => {
    expect(await pickDevice(undefined)).toBe("wasm")
    expect(await pickDevice({ requestAdapter: async () => null })).toBe("wasm")
    expect(await pickDevice({ requestAdapter: async () => ({ isFallbackAdapter: true }) })).toBe("wasm")
    expect(await pickDevice({ requestAdapter: async () => ({ info: { isFallbackAdapter: true } }) })).toBe("wasm")
    expect(await pickDevice({ requestAdapter: async () => Promise.reject(new Error("no")) })).toBe("wasm")
    expect(await pickDevice({ requestAdapter: async () => ({ info: { isFallbackAdapter: false } }) })).toBe("webgpu")
  })
})

class MemoryCache {
  readonly kept = new Map<string, Uint8Array>()
  async match(key: string) {
    const b = this.kept.get(key)
    return b ? new Response(b) : undefined
  }
  async put(key: string, res: Response) {
    this.kept.set(key, new Uint8Array(await res.arrayBuffer()))
  }
}

describe("downloading the model", () => {
  const stores = new Map<string, MemoryCache>()
  const real = Reflect.get(globalThis, "caches")
  beforeEach(() => {
    stores.clear()
    Reflect.set(globalThis, "caches", {
      open: async (name: string) => stores.get(name) ?? stores.set(name, new MemoryCache()).get(name)!,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    })
  })
  afterEach(() => Reflect.set(globalThis, "caches", real))

  const relay = "https://relay.test"
  const fakeRelay = (bad: string | null, calls: string[]) => async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    expect(init?.cache).toBe("no-store")
    const name = url.slice(`${relay}${DICTATION_PATH}`.length)
    const file = DICTATION_FILES[name]!
    return new Response(name === bad ? new Uint8Array(file.size) : new Uint8Array(file.size))
  }

  test("each file comes from the relay, and one that doesn't match its pinned hash is never kept", async () => {
    stores.set("kiwi-dictation-0", new MemoryCache())
    const calls: string[] = []
    const seen: number[] = []
    const err = await downloadModel(relay, (f) => seen.push(f), fakeRelay(null, calls) as typeof fetch).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DictationProblem)
    expect((err as Error).message).toContain("didn't match its pinned hash")
    expect(calls).toEqual([`${relay}${DICTATION_PATH}${Object.keys(DICTATION_FILES)[0]}`])
    expect(stores.get(CACHE_NAME)!.kept.size).toBe(0)
    expect(stores.has("kiwi-dictation-0")).toBe(false)
    expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true)
    expect(await modelReady()).toBe(false)
  })

  test("a relay that says no is shown as it said it", async () => {
    const err = await downloadModel(relay, () => undefined, (async () => new Response("This relay can't fetch the dictation model right now.\n", { status: 502 })) as unknown as typeof fetch).catch(
      (e: unknown) => e
    )
    expect((err as Error).message).toBe("Dictation isn't available here. This relay can't fetch the dictation model right now.")
  })
})

describe("the microphone and the speech model", () => {
  const recording = () => {
    const r = { cancelled: false, cancel: () => void (r.cancelled = true), stop: async () => new Float32Array(0) }
    return r
  }

  test("a second press while the first is still opening the mic opens nothing, and the first one keeps it", async () => {
    const gate: MicGate = { alive: true, opening: false, current: null }
    let opened = 0
    let release: (r: Recording) => void = () => {}
    const first = recording()
    const open = () => (opened++, new Promise<Recording>((ok) => (release = ok)))
    const one = openRecording(gate, open)
    expect(await openRecording(gate, open)).toBeNull()
    release(first)
    expect(await one).toBe(first)
    expect([opened, gate.current === first, first.cancelled]).toEqual([1, true, false])
  })

  test("a mic that opens after the composer is gone, or after another recording took it, is closed at once", async () => {
    const gate: MicGate = { alive: true, opening: false, current: null }
    const late = recording()
    let release: (r: Recording) => void = () => {}
    const opening = openRecording(gate, () => new Promise<Recording>((ok) => (release = ok)))
    gate.alive = false
    release(late)
    expect(await opening).toBeNull()
    expect(late.cancelled).toBe(true)
    expect(await openRecording(gate, async () => recording())).toBeNull()
    const taken: MicGate = { alive: true, opening: false, current: recording() }
    expect(await openRecording(taken, async () => recording())).toBeNull()
  })

  test("a speech model that crashes ends the transcription with a message, and the next one starts a fresh model", async () => {
    const workers: (SpeechWorker & { posted: ToWorker[]; terminated: boolean })[] = []
    const make = () => {
      const w = {
        onmessage: null,
        onerror: null,
        onmessageerror: null,
        posted: [] as ToWorker[],
        terminated: false,
        postMessage: (m: ToWorker) => void w.posted.push(m),
        terminate: () => void (w.terminated = true),
      } as SpeechWorker & { posted: ToWorker[]; terminated: boolean }
      workers.push(w)
      return w
    }
    const transcribe = transcriber(make)
    const first = transcribe(new Float32Array(4), "en")
    workers[0]!.onerror?.({} as ErrorEvent)
    await expect(first).rejects.toThrow(/speech model stopped/)
    expect(workers[0]!.terminated).toBe(true)
    const second = transcribe(new Float32Array(4), "en")
    expect(workers).toHaveLength(2)
    const id = workers[1]!.posted[0]!.id
    workers[1]!.onmessage?.({ data: { id, text: "hello there" } } as MessageEvent)
    expect(await second).toBe("hello there")
  })
})

describe("loading the engine", () => {
  test("a load that fails says to reload, since Electron's Chromium keeps a failed import until then, and the next press loads again where it can", async () => {
    const real = await import("./engine")
    let tries = 0
    const engine = engineLoader(() => (++tries === 1 ? Promise.reject(new TypeError("Failed to fetch dynamically imported module")) : Promise.resolve(real)))
    const failed = await engine().catch((err: unknown) => err)
    expect(failed).toBeInstanceOf(DictationProblem)
    expect((failed as DictationProblem).message).toBe("Dictation couldn't load. Reload to try again.")
    expect(await engine()).toBe(real)
    expect(await engine()).toBe(real)
    expect(tries).toBe(2)
  })
})

describe("lazy", () => {
  test("the first load carries only the hook: the model, the recorder, the transcriber and core's file table load on the first mic press", () => {
    const src = resolve(import.meta.dir, "../..")
    const here = resolve(import.meta.dir)
    const lazy = new Set(["engine", "model", "recorder", "worker"].map((n) => join(here, n)))
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [join(dir, n)] : []))
    const static_ = /^\s*import\s(?!type\b)(?:(?!\bimport\b)[^;])*?from\s+["']([^"']+)["']/gm
    const target = (file: string, spec: string) => (spec.startsWith("@/") ? join(src, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(file), spec) : spec).replace(/\.tsx?$/, "")
    const bad = files(src)
      .filter((f) => !lazy.has(f.replace(/\.tsx?$/, "")))
      .flatMap((f) => [...readFileSync(f, "utf8").matchAll(static_)].map((m) => [f, m[1]!] as const))
      .filter(([f, spec]) => spec === "@kiwi/core/dictation.ts" || lazy.has(target(f, spec)))
      .map(([f, spec]) => `${relative(src, f)}: ${spec}`)
    expect(bad).toEqual([])
  })
})
