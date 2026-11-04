function authorIn(state: unknown): string | null {
  if (typeof state !== "object" || state === null || !("kiwi" in state)) return null
  const k = state.kiwi
  return typeof k === "object" && k !== null && "author" in k && typeof k.author === "string" ? k.author : null
}

export const caretShown =
  (me: string) =>
  (here: number, there: number, state: unknown): boolean =>
    here !== there && authorIn(state) !== me
