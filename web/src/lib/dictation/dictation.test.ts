import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { DICTATION_BYTES, DICTATION_FILES, DICTATION_PATH } from "@kiwi/core/dictation.ts"
import { pickDevice } from "./device"
import { appendDictation, dictationSupported, MODEL_MB, PRESS_LABEL, speechLanguage } from "./index"
import { CACHE_NAME, DictationProblem, downloadModel, modelReady } from "./model"

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
