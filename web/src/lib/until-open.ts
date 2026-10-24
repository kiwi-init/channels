import { ChannelGone } from "@kiwi/core/client/relay-errors.ts"

export async function untilOpen<A>(open: () => Promise<A>, status: (line: string) => void, stopped: () => boolean, wait = 500): Promise<A> {
  for (let next = wait; ; next = Math.min(next * 2, 30_000)) {
    try {
      return await open()
    } catch (err) {
      if (err instanceof ChannelGone || stopped()) throw err
      status("can't reach the relay; still retrying")
      if (next > 0) await new Promise((r) => setTimeout(r, next))
      if (stopped()) throw err
    }
  }
}
