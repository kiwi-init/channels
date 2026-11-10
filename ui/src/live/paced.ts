export const FOCUS_GAP_MS = 10_000

export function paced<T>(run: () => Promise<T>, took: (value: T) => void, gapMs: number = FOCUS_GAP_MS, now: () => number = Date.now): () => void {
  let asking = false
  let last = -Infinity
  return () => {
    if (asking || now() - last < gapMs) return
    asking = true
    void run()
      .then(
        (value) => {
          last = now()
          took(value)
        },
        () => {}
      )
      .finally(() => (asking = false))
  }
}
