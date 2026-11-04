export interface TypingNote {
  what: string
  block?: string
  origin?: string
  before?: number
  after?: number
  count?: number
}

let sink: ((n: TypingNote) => void) | null = null

export function setTypingSink(next: ((n: TypingNote) => void) | null): void {
  sink = next
}

export const tracingTyping = (): boolean => sink !== null

export function noteTyping(make: () => TypingNote): void {
  if (sink) sink(make())
}
