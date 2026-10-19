import { env, pipeline } from "@huggingface/transformers"
import glue from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url"

import { ORT_WASM, WHISPER_MODEL } from "@kiwi/core/dictation.ts"
import { pickDevice, type Device } from "./device"
import { cachedFile } from "./model"

export type ToWorker = { id: number; audio: Float32Array; language: string | null }
export type FromWorker = { id: number; text: string } | { id: number; error: string }

const HOST = "https://dictation.kiwi.invalid/"

env.allowLocalModels = false
env.remoteHost = HOST
env.remotePathTemplate = "{model}/"
env.useBrowserCache = false
env.useWasmCache = false
env.fetch = async (input: string | URL) => {
  const url = String(input)
  const bytes = url.startsWith(HOST) ? await cachedFile(url.slice(HOST.length)) : null
  return bytes ? new Response(bytes) : new Response(null, { status: 404 })
}

type Transcribe = (audio: Float32Array, options: { language?: string; task?: "transcribe" }) => Promise<{ text: string } | { text: string }[]>

const open = async (device: Device): Promise<Transcribe> => (await pipeline("automatic-speech-recognition", WHISPER_MODEL, { device, dtype: "q8" })) as unknown as Transcribe

async function load(): Promise<Transcribe> {
  const wasmBinary = await cachedFile(`ort/${ORT_WASM}`)
  const wasm = env.backends.onnx.wasm
  if (!wasmBinary || !wasm) throw new Error("The dictation model isn't downloaded yet.")
  wasm.wasmPaths = { mjs: new URL(glue, self.location.href).href }
  wasm.wasmBinary = wasmBinary
  wasm.numThreads = 1
  const device = await pickDevice()
  try {
    return await open(device)
  } catch (err) {
    if (device === "wasm") throw err
    return open("wasm")
  }
}

let ready: Promise<Transcribe> | null = null

async function transcribe(audio: Float32Array, language: string | null): Promise<string> {
  ready ??= load().catch((err: unknown) => {
    ready = null
    throw err
  })
  const run = await ready
  const out = await run(audio, language ? { language, task: "transcribe" } : {}).catch((err: unknown) => {
    if (!language) throw err
    return run(audio, {})
  })
  return (Array.isArray(out) ? out.map((o) => o.text).join(" ") : out.text).trim()
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const { id, audio, language } = e.data
  transcribe(audio, language).then(
    (text) => self.postMessage({ id, text } satisfies FromWorker),
    (err: unknown) => self.postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies FromWorker)
  )
}
