import { useEffect, useMemo, useRef, useState } from "react"

import { loadMember, type StoredMember } from "@kiwi/channel/store.ts"
import { useChannel } from "@kiwi/channel/use-channel.ts"
import type { ModRoomMessage } from "~/mods/protocol"
import { READ_KEEP, roomMessages } from "~/mods/read"

export type Heard = (code: string, room: string, list: ModRoomMessage[]) => void

const PAGES = 6

export default function Readers({ wanted, heard }: { wanted: ReadonlyMap<string, readonly string[]>; heard: Heard }) {
  const codes = [...wanted.keys()].sort().join("\n")
  const members = useMemo(() => codes.split("\n").flatMap((code) => (code ? (loadMember(code) ?? []) : [])), [codes])
  return members.map((m) => <Reader key={m.code} member={m} rooms={wanted.get(m.code) ?? []} heard={heard} />)
}

function Reader({ member, rooms, heard }: { member: StoredMember; rooms: readonly string[]; heard: Heard }) {
  const { state, messages, older, ready } = useChannel(member, undefined, true)
  const key = rooms.join("\n")
  const lists = useMemo(() => key.split("\n").map((room) => ({ room, list: roomMessages(state, messages, room) })), [state, messages, key])
  const paging = useRef({ pages: 0, done: false, busy: false })
  const [paged, setPaged] = useState(0)
  useEffect(() => {
    for (const { room, list } of lists) heard(member.code, room, list)
  }, [lists, heard, member.code])
  useEffect(() => {
    const p = paging.current
    if (!ready || p.done || p.busy || p.pages >= PAGES || lists.every((l) => l.list.length >= READ_KEEP)) return
    p.busy = true
    p.pages++
    void older
      .more()
      .then(
        (more) => void (p.done = !more),
        () => void (p.done = true)
      )
      .finally(() => {
        p.busy = false
        setPaged((n) => n + 1)
      })
  }, [ready, lists, older, paged])
  return null
}
