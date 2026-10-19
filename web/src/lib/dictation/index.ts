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

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>()

function transcribe(audio: Float32Array): Promise<string> {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const w = waiting.get(e.data.id)
      waiting.delete(e.data.id)
      if (!w) return
      if ("error" in e.data) w.reject(new DictationProblem(`Dictation failed: ${e.data.error}`))
      else w.resolve(e.data.text)
    }
  }
  const id = nextId++
  const message: ToWorker = { id, audio, language: speechLanguage(navigator.language) }
  return new Promise<string>((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    worker!.postMessage(message, [audio.buffer])
  })
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
  const recording = useRef<Recording | null>(null)
  const text = useRef(onText)
  const problem = useRef(onProblem)

  useEffect(() => {
    text.current = onText
    problem.current = onProblem
  })

  useEffect(
    () => () => {
      recording.current?.cancel()
      recording.current = null
    },
    []
  )

  const fail = useCallback((err: unknown) => {
    recording.current = null
    setPhase("idle")
    problem.current(problemText(err))
  }, [])

  const listen = useCallback(async () => {
    try {
      recording.current = await record()
      setPhase("listening")
    } catch (err) {
      fail(err)
    }
  }, [fail])

  const finish = useCallback(async () => {
    const active = recording.current
    recording.current = null
    if (!active) return
    setPhase("transcribing")
    try {
      const said = await transcribe(await active.stop())
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
    return listen()
  }, [listen, fail])

  const cancel = useCallback(() => setPhase("idle"), [])

  return { supported, phase, progress, press, confirm, cancel }
}
