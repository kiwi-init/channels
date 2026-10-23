import type { SendOptions } from "@kiwi/core/client.ts"

export function sendsInTurn(): <T>(run: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve()
  return <T>(run: () => Promise<T>): Promise<T> => {
    const next = last.then(run, run)
    last = next.catch(() => undefined)
    return next
  }
}

export async function withSentQuotes(o: SendOptions, sent: (key: number) => Promise<number> | undefined): Promise<SendOptions> {
  if (!o.re?.some((seq) => seq < 0)) return o
  const re = (await Promise.all(o.re.map((seq) => (seq < 0 ? (sent(-seq) ?? Promise.resolve(null)).catch(() => null) : seq)))).filter((seq): seq is number => seq !== null)
  return { ...o, re: re.length ? re : undefined }
}
