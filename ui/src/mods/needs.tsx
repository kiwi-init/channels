import { useEffect, useState } from "react"

import type { ModRoom } from "../../../desktop/src/bridge.ts"
import { cx } from "~/kit/bits"
import type { ChannelTile } from "~/model"
import { roomLink } from "~/mods/link"

const WORDS: Record<string, string> = {
  panel: "A panel beside the chat",
  sidebar: "A section in the sidebar",
  tab: "A tab in the channel's header",
  github: "Sees this channel's repos, PRs and issues",
  command: "Commands in ⌘K",
  "message-action": "Items in a message's menu, which send it that message when you pick one",
  terminal: "Show your agents' terminals and mark the ones that need you",
  idle: "Covers the whole window while you're away; a key or a click brings the app back",
  channels: "Sees every channel's name, how many need you, and its last line",
}

const roomWords = (need: string): string | null => {
  const room = need.replace(/^(post|read):#?/, "")
  if (need.startsWith("post:")) return `Post in #${room} of the channels you tick, as you, with a line saying it came from this mod`
  if (need.startsWith("read:")) return `Read #${room} of the channels you tick`
  return null
}

export const needWords = (need: string): string =>
  need.startsWith("net:") ? `Talk to ${need.slice(4)}` : need.startsWith("render:") ? `Draw ${need.slice(7)} attachments in chat, live` : (roomWords(need) ?? WORDS[need] ?? need)

function useRoomsOf(codes: readonly string[], wanted: boolean): Map<string, Set<string>> {
  const [known, setKnown] = useState(() => new Map<string, Set<string>>())
  const key = codes.join("\n")
  useEffect(() => {
    if (!wanted) return
    let live = true
    const learn = (code: string, ids: readonly string[]) => {
      if (live) setKnown((m) => new Map(m).set(code, new Set(["general", ...ids])))
    }
    for (const code of key.split("\n").filter(Boolean))
      void roomLink(code)
        .rooms()
        .then(
          (s) =>
            learn(
              code,
              (s?.list ?? []).map((r) => r.id)
            ),
          () => learn(code, [])
        )
    return () => {
      live = false
    }
  }, [key, wanted])
  return known
}

export function RoomPicker({ rooms, channels, value, onChange }: { rooms: readonly string[]; channels: readonly ChannelTile[]; value: readonly ModRoom[]; onChange: (next: ModRoom[]) => void }) {
  const known = useRoomsOf(
    channels.map((c) => c.code),
    rooms.some((r) => r !== "general")
  )
  const has = (code: string, room: string) => value.some((v) => v.code === code && v.room === room)
  const pick = (code: string, room: string, on: boolean) =>
    onChange(on ? [...value.filter((v) => v.code !== code || v.room !== room), { code, room }] : value.filter((v) => v.code !== code || v.room !== room))
  return (
    <div className="mod-rooms">
      {rooms.map((room) => {
        const list = channels.filter((c) => room === "general" || known.get(c.code)?.has(room))
        const looking = room !== "general" && channels.some((c) => !known.has(c.code))
        return (
          <fieldset key={room} className="mod-room-group">
            <legend>#{room} in</legend>
            {list.map((c) => (
              <label key={c.code} className={cx("mod-room", has(c.code, room) && "is-on")}>
                <input type="checkbox" checked={has(c.code, room)} onChange={(e) => pick(c.code, room, e.target.checked)} />
                <span className="mod-room-name">{c.title}</span>
              </label>
            ))}
            {looking && <p className="mod-room-none">Looking through your channels…</p>}
            {!looking && !list.length && <p className="mod-room-none">None of your channels has #{room}.</p>}
          </fieldset>
        )
      })}
    </div>
  )
}
