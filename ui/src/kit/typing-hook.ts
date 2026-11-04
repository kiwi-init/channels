export interface TypingNote {
  what: string
  block?: string
  origin?: string
  before?: number
  after?: number
  count?: number
  doc?: string
}

export interface TypingFocus {
  block: string
  doc: string
  editor: number
  stored: number
}

let sink: ((n: TypingNote) => void) | null = null
let focus: (() => TypingFocus | null) | null = null

export function setTypingSink(next: ((n: TypingNote) => void) | null): void {
  sink = next
}

export const tracingTyping = (): boolean => sink !== null

export function noteTyping(make: () => TypingNote): void {
  if (sink) sink(make())
}

export function setTypingFocus(next: () => TypingFocus | null): () => void {
  focus = next
  return () => {
    if (focus === next) focus = null
  }
}

export const typingFocus = (): TypingFocus | null => focus?.() ?? null
