import { loadMember } from "@kiwi/channel/store.ts"
import { linkOf, type ChannelLink } from "@kiwi/channel/channel-ops.ts"
import { t } from "~/i18n/i18n"
import { openedRun } from "~/live/store"

export function link(code: string): ChannelLink {
  const run = openedRun(code)
  if (run) return run.ch
  const m = loadMember(code)
  if (!m) throw new Error(t("live.run.not.in.channel"))
  return linkOf(m)
}
