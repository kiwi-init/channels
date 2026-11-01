import { useEffect } from "react"

import type { Member } from "@kiwi/core/membership.ts"
import type { Message as Wire } from "@kiwi/core/protocol.ts"
import { answersDecisions } from "@kiwi/core/state.ts"
import { loadMember } from "@kiwi/channel/store.ts"
import { type ChannelRow } from "@kiwi/channel/list.ts"
import { ops, watches } from "@kiwi/channel/channel-ops.ts"
import { bridge } from "@kiwi/secrets/secrets.ts"
import { named as withNicknames } from "~/chat/linked"
import { elsewhere, heardHeads, messageHash, messageLink, noteBody, noteTitle, rootedPlace, rootOf, type NotePlace } from "~/live/notify"
import { chime } from "~/live/alerts"
import { ownPrefs } from "~/live/prefs"
import { forYou, tells } from "~/live/quiet"
import { nicknamesOf } from "~/names"

function tell(title: string, body: string, code: string, seq: number): void {
  const b = bridge()
  if (b) return void b.notify(title, body, messageLink(code, seq)).catch(() => {})
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return
  const note = new Notification(title, { body, silent: true })
  note.onclick = () => {
    window.focus()
    location.hash = messageHash(code, seq)
    note.close()
  }
}

export interface Told {
  me: string
  channel: string
  code: string
  place: NotePlace
  members: Iterable<Pick<Member, "name" | "display">>
  display: string | undefined
}

export function tellMessage(m: Wire, t: Told): void {
  const prefs = ownPrefs()
  if (prefs.mentionSound && (forYou(m, t.me) || t.place.kind === "dm")) chime()
  const images = m.imgs?.length ?? 0
  const body = noteBody(withNicknames(m.body, nicknamesOf(t.members))) || (images ? `Sent ${images === 1 ? "an image" : `${images} images`}` : "")
  tell(noteTitle(m, t.me, t.display || m.from, t.channel, t.place), body, t.code, m.seq)
}

const PARENT_REACH = 500

async function placeElsewhere(code: string, m: Wire, fetched: readonly Wire[], head: number): Promise<NotePlace> {
  const known = new Map(fetched.map((x) => [x.seq, x]))
  let found = rootOf(m, known)
  while (found.kind === "missing" && head - found.seq <= PARENT_REACH) {
    const wanted = found.seq
    const { messages } = await ops().call(code, "history", wanted - 1)
    for (const x of messages) known.set(x.seq, x)
    if (!known.has(wanted)) break
    found = rootOf(m, known)
  }
  if (found.kind === "missing") return { kind: "thread" }
  const place = rootedPlace(found)
  if (place.kind !== "room") return place
  const rooms = await ops()
    .call(code, "rooms")
    .catch(() => null)
  return { kind: "room", name: rooms?.list.find((r) => r.id === place.name)?.name ?? place.name }
}

async function readElsewhere(code: string, after: number, upTo: number, title: string): Promise<void> {
  const me = loadMember(code)?.identity.name
  if (!me) return
  const prefs = ownPrefs()
  const now = Date.now()
  const { messages } = await ops().call(code, "history", after)
  const fresh = messages.filter((m) => m.seq > after && m.seq <= upTo)
  if (!fresh.some((m) => m.sigOk && tells(m, me, prefs, code, true, now))) return
  const members = await ops().call(code, "members")
  const byName = new Map(members.map((m) => [m.name, m]))
  const decides = answersDecisions(byName, me)
  const last = fresh.findLast((m) => m.sigOk && tells(m, me, prefs, code, decides, now))
  if (!last) return
  const place = await placeElsewhere(code, last, messages, upTo)
  tellMessage(last, { me, channel: title, code, place, members, display: byName.get(last.from)?.display })
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
