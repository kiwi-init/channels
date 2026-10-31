import { PRIVATE_ROOM_OPS } from "@kiwi/core/protocol.ts"
import { roomReadiness } from "@kiwi/core/room-rules.ts"
import type { Person } from "~/model"
import { shown } from "~/names"

export function RoomReadyNotes({ people }: { people: readonly Person[] }) {
  const notes = people.flatMap((p) => {
    const state = roomReadiness(p.ops, p.opsLive ? [p.opsLive] : [], PRIVATE_ROOM_OPS)
    if (state === "ready") return []
    const name = shown(p)
    const runs = p.kind === "agent" ? "kiwi" : "app"
    const devices = Object.values(p.ops ?? {}).filter((v) => v > 0).length > 1
    return [
      state === "old"
        ? { name: p.name, old: true, text: `${devices ? `One of ${name}'s devices` : `${name}'s ${runs}`} can't open private rooms yet. ${name} can read this room after updating.` }
        : { name: p.name, old: false, text: `${name}'s ${runs} hasn't been seen since private rooms shipped. If ${name} is on an older version, an update is needed.` },
    ]
  })
  if (!notes.length) return null
  return (
    <ul className="room-ready" aria-live="polite">
      {notes.map((n) => (
        <li key={n.name} className={n.old ? "is-old" : undefined}>
          {n.text}
        </li>
      ))}
    </ul>
  )
}
