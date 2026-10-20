import { RelayError } from "@kiwi/core/client/errors.ts"

const worthRetrying = (err: unknown): boolean => err instanceof TypeError || (err instanceof RelayError && (err.status === 429 || err.status >= 500))

export async function drain<T extends { seq: number }>(items: readonly T[], post: (item: T) => Promise<unknown>, done: (seq: number) => void): Promise<boolean> {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    try {
      await post(item)
    } catch (err) {
      if (worthRetrying(err)) return false
    }
    if (items[i + 1]?.seq !== item.seq) done(item.seq)
  }
  return true
}
