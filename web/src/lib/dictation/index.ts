import { useCallback, useEffect, useRef, useState } from "react"

import { DICTATION_BYTES } from "@kiwi/core/dictation.ts"
import { relayUrl } from "@/lib/relay"
import { DictationProblem, downloadModel, modelReady } from "./model"
import { record, type Recording } from "./recorder"
import type { FromWorker, ToWorker } from "./worker"

export type DictationPhase = "idle" | "asking" | "downloading" | "listening" | "transcribing"

export const MODEL_MB = Math.round(DICTATION_BYTES / 1e6)

export const PRESS_LABEL: Record<DictationPhase, string> = {
  idle: "Dictate",
  asking: "Dictate",
  downloading: "Downloading the dictation model",
  listening: "Stop dictation",
  transcribing: "Transcribing",
}

export function appendDictation(body: string, transcript: string): string {
  const text = transcript.trim()
  if (!text) return body
  if (!body || /\s$/.test(body)) return body + text
  return `${body} ${text}`
}

export function speechLanguage(tag: string | undefined): string | null {
  const code = tag?.split("-")[0]?.toLowerCase()
  return code && /^[a-z]{2,3}$/.test(code) ? code : null
}

export function dictationSupported(scope: typeof globalThis = globalThis): boolean {
  return (
    typeof scope.navigator?.mediaDevices?.getUserMedia === "function" &&
    typeof scope.MediaRecorder === "function" &&
    typeof scope.Worker === "function" &&
    typeof scope.WebAssembly === "object" &&
    typeof scope.caches === "object" &&
    typeof scope.OfflineAudioContext === "function"
  )
}

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

const transcribe = transcriber(() => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }))

export interface MicGate {
  alive: boolean
  opening: boolean
  current: Recording | null
}

export async function openRecording(gate: MicGate, open: () => Promise<Recording>): Promise<Recording | null> {
  if (!gate.alive || gate.opening || gate.current) return null
  gate.opening = true
  try {
    const recording = await open()
    if (!gate.alive || gate.current) {
      recording.cancel()
      return null
    }
    gate.current = recording
    return recording
  } finally {
    gate.opening = false
  }
}

const problemText = (err: unknown) =>
  err instanceof DictationProblem
    ? err.message
    : err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")
      ? "Microphone blocked: allow it for this app to dictate."
      : err instanceof DOMException && err.name === "NotFoundError"
        ? "No microphone found."
        : "Dictation failed. Try again."

export function useDictation(onText: (text: string) => void, onProblem: (message: string) => void) {
  const [supported] = useState(() => dictationSupported())
  const [phase, setPhase] = useState<DictationPhase>("idle")
  const [progress, setProgress] = useState(0)
  const mic = useRef<MicGate>({ alive: true, opening: false, current: null })
  const text = useRef(onText)
  const problem = useRef(onProblem)

  useEffect(() => {
    text.current = onText
    problem.current = onProblem
  })

  useEffect(() => {
    const gate = mic.current
    gate.alive = true
    return () => {
      gate.alive = false
      gate.current?.cancel()
      gate.current = null
    }
  }, [])

  const fail = useCallback((err: unknown) => {
    mic.current.current = null
    if (!mic.current.alive) return
    setPhase("idle")
    problem.current(problemText(err))
  }, [])

  const listen = useCallback(async () => {
    try {
      if (await openRecording(mic.current, record)) setPhase("listening")
    } catch (err) {
      fail(err)
    }
  }, [fail])

  const finish = useCallback(async () => {
    const active = mic.current.current
    mic.current.current = null
    if (!active) return
    setPhase("transcribing")
    try {
      const said = await transcribe(await active.stop(), speechLanguage(navigator.language))
      if (said) text.current(said)
      setPhase("idle")
    } catch (err) {
      fail(err)
    }
  }, [fail])

  const press = useCallback(async () => {
    if (phase === "listening") return finish()
    if (phase !== "idle") return
    try {
      if (await modelReady()) return listen()
      setPhase("asking")
    } catch (err) {
      fail(err)
    }
  }, [phase, finish, listen, fail])

  const confirm = useCallback(async () => {
    setProgress(0)
    setPhase("downloading")
    try {
      await downloadModel(relayUrl(), setProgress)
    } catch (err) {
      return fail(err)
    }
    if (mic.current.alive) return listen()
  }, [listen, fail])

  const cancel = useCallback(() => setPhase("idle"), [])

  return { supported, phase, progress, press, confirm, cancel }
}
