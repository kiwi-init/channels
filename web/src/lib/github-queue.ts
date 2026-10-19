import { RelayError } from "@kiwi/core/client/errors.ts"

const worthRetrying = (err: unknown): boolean => err instanceof TypeError || (err instanceof RelayError && (err.status === 429 || err.status >= 500))

export async function drain<T extends { seq: number }>(items: readonly T[], post: (item: T) => Promise<unknown>, done: (seq: number) => void): Promise<boolean> {
  for (const item of items) {
    try {
      await post(item)
    } catch (err) {
      if (worthRetrying(err)) return false
    }
    done(item.seq)
  }
  return true
}
