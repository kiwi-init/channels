import { useEffect } from "react"

import type { Member } from "@kiwi/core/membership.ts"
import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { answersDecisions } from "@kiwi/core/state.ts"
import { loadMember, type ChannelRow } from "@/lib/channel"
import { ops, watches } from "@/lib/channel-ops"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { named as withNicknames } from "~/chat/linked"
import { channelLink, elsewhere, heardHeads, lastWorth } from "~/live/notify"
import { ownPrefs } from "~/live/prefs"
import { nicknamesOf } from "~/names"

function tell(title: string, body: string, code: string): void {
  const b = bridge()
  if (b) return void b.notify(title, body, channelLink(code)).catch(() => {})
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return
  const note = new Notification(title, { body, silent: true })
  note.onclick = () => {
    window.focus()
    location.hash = encodeURIComponent(code)
    note.close()
  }
}

export function tellMessage(m: Wire, title: string, code: string, members: Iterable<Pick<Member, "name" | "display">>, display: string | undefined): void {
  tell(`${display || m.from} in ${title}`, withNicknames(m.body, nicknamesOf(members)).slice(0, 200), code)
}

async function readElsewhere(code: string, after: number, upTo: number, title: string): Promise<void> {
  const me = loadMember(code)?.identity.name
  if (!me) return
  const { notify } = ownPrefs()
  const { messages } = await ops().call(code, "history", after)
  const fresh = messages.filter((m) => m.seq > after && m.seq <= upTo)
  if (!lastWorth(fresh, me, notify, true)) return
  const members = await ops().call(code, "members")
  const byName = new Map(members.map((m) => [m.name, m]))
  const last = lastWorth(fresh, me, notify, answersDecisions(byName, me))
  if (last) tellMessage(last, title, code, members, byName.get(last.from)?.display)
}

let openNow: string | null = null
let titles = new Map<string, string>()

const heads = heardHeads(
  (code) => code === openNow || !elsewhere() || ownPrefs().notify === "none",
  (code, after, upTo) => readElsewhere(code, after, upTo, titles.get(code) ?? "a channel")
)

export function useNotesElsewhere(rows: ChannelRow[], open: string | null): void {
  useEffect(() => {
    openNow = open
  }, [open])
  useEffect(() => {
    titles = new Map(rows.map((r) => [r.code, r.title]))
    for (const r of rows) if (r.state === "member" && r.head !== undefined) heads.start(r.code, r.head)
  }, [rows])
  const memberKey = rows
    .filter((r) => r.state === "member")
    .map((r) => r.code)
    .sort()
    .join("\n")
  useEffect(() => {
    if (!memberKey) return
    const stops = memberKey.split("\n").map((code) =>
      watches().watch(code, (ev) => {
        if (ev._tag === "Head") heads.head(code, ev.seq)
      })
    )
    return () => {
      for (const stop of stops) stop()
    }
  }, [memberKey])
}
