import { useCallback, useEffect, useRef, useState } from "react"

interface DictationAlternative {
  readonly transcript: string
}

interface DictationResult {
  readonly isFinal: boolean
  readonly [index: number]: DictationAlternative | undefined
}

interface DictationEvent {
  readonly resultIndex: number
  readonly results: { readonly length: number; readonly [index: number]: DictationResult | undefined }
}

interface Dictation {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: DictationEvent) => void) | null
  onerror: ((event: { readonly error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type DictationCtor = new () => Dictation

const UNAVAILABLE = new Set(["network", "service-not-allowed", "language-not-supported"])
const BLOCKED = new Set(["not-allowed", "audio-capture"])

function dictationCtor(): DictationCtor | undefined {
  if (typeof window === "undefined") return undefined
  for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
    const found: unknown = Reflect.get(window, name)
    if (typeof found === "function") return found as DictationCtor
  }
  return undefined
}

export function appendDictation(body: string, transcript: string): string {
  const text = transcript.trim()
  if (!text) return body
  if (!body || /\s$/.test(body)) return body + text
  return `${body} ${text}`
}

export function useDictation(onText: (text: string) => void, onProblem: (message: string) => void) {
  const [supported, setSupported] = useState(() => dictationCtor() !== undefined)
  const [listening, setListening] = useState(false)
  const active = useRef<Dictation | null>(null)
  const text = useRef(onText)
  const problem = useRef(onProblem)

  useEffect(() => {
    text.current = onText
    problem.current = onProblem
  })

  useEffect(
    () => () => {
      active.current?.abort()
      active.current = null
    },
    []
  )

  const toggle = useCallback(() => {
    if (active.current) return active.current.stop()
    const Ctor = dictationCtor()
    if (!Ctor) return setSupported(false)
    const recognition = new Ctor()
    recognition.lang = navigator.language
    recognition.continuous = true
    recognition.interimResults = false
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const alternative = result?.[0]
        if (result?.isFinal && alternative) text.current(alternative.transcript)
      }
    }
    recognition.onerror = (event) => {
      if (UNAVAILABLE.has(event.error)) setSupported(false)
      else if (BLOCKED.has(event.error)) problem.current("Microphone blocked: allow it for this site to dictate.")
    }
    recognition.onend = () => {
      if (active.current === recognition) active.current = null
      setListening(false)
    }
    active.current = recognition
    try {
      recognition.start()
      setListening(true)
    } catch {
      active.current = null
      setSupported(false)
    }
  }, [])

  return { supported, listening, toggle }
}
