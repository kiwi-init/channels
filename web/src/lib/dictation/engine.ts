import { DICTATION_BYTES } from "@kiwi/core/dictation.ts"
import { DictationProblem } from "./problem"
import type { FromWorker, ToWorker } from "./worker"

export { downloadModel, modelReady } from "./model"
export { record } from "./recorder"

export const MODEL_MB = Math.round(DICTATION_BYTES / 1e6)

export interface SpeechWorker {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  onmessageerror: ((e: MessageEvent) => void) | null
  postMessage(message: ToWorker, transfer: Transferable[]): void
  terminate(): void
}

export function transcriber(make: () => SpeechWorker): (audio: Float32Array, language: string | null) => Promise<string> {
  let worker: SpeechWorker | null = null
  let nextId = 1
  const waiting = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>()
  const crashed = (w: SpeechWorker) => () => {
    if (worker === w) worker = null
    w.terminate()
    for (const one of waiting.values()) one.reject(new DictationProblem("Dictation failed: the speech model stopped. Try again."))
    waiting.clear()
  }
  return (audio, language) => {
    if (!worker) {
      const w = make()
      worker = w
      w.onmessage = (e) => {
        const one = waiting.get(e.data.id)
        waiting.delete(e.data.id)
        if (!one) return
        if ("error" in e.data) one.reject(new DictationProblem(`Dictation failed: ${e.data.error}`))
        else one.resolve(e.data.text)
      }
      w.onerror = crashed(w)
      w.onmessageerror = crashed(w)
    }
    const id = nextId++
    const message: ToWorker = { id, audio, language }
    const w = worker
    return new Promise<string>((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      w.postMessage(message, [audio.buffer])
    })
  }
}

export const transcribe = transcriber(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }))
