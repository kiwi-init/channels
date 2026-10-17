let waiting: string | null = null

export function holdJoin(code: string): void {
  waiting = code
}

export function takeJoin(): string | null {
  const code = waiting
  waiting = null
  return code
}
