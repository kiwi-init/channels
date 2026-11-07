import { linkOf, type ChannelLink } from "@kiwi/channel/channel-ops.ts"
import { loadMember } from "@kiwi/channel/store.ts"
import { openedRun } from "~/live/store"

export function roomLink(code: string): ChannelLink {
  const run = openedRun(code)
  if (run) return run.ch
  const m = loadMember(code)
  if (!m) throw new Error("you're not in that channel")
  return linkOf(m)
}
