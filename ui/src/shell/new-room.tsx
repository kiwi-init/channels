import "~/styles/new-room.css"

import { useState } from "react"

import { roomProblem } from "@kiwi/app/rooms.ts"
import { Avatar, cx, Dialog, DialogHead, Field } from "~/kit/bits"
import { Track } from "~/kit/glide"
import type { Channel } from "~/model"
import { useApp } from "~/nav"
import { shown } from "~/names"
import { RoomReadyNotes } from "~/shell/room-ready"

const roomName = (typed: string): string => typed.trim().replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-")

export function NewRoomDialog({ channel }: { channel: Channel }) {
  const { nav, go } = useApp()
  const open = nav.dialog === "new-room"
  const close = () => go({ to: "dialog", dialog: null })
  return (
    <Dialog open={open} onClose={() => open && close()} label="New room">
      <NewRoomForm channel={channel} onClose={close} />
    </Dialog>
  )
}

function NewRoomForm({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { app, go } = useApp()
  const [typed, setTyped] = useState("")
  const [only, setOnly] = useState(false)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const name = roomName(typed)
  const problem = name ? roomProblem(channel.rooms, name) : null
  const others = channel.people.filter((p) => !p.you && !p.left)
  const people = others.filter((p) => p.kind === "human")
  const agents = others.filter((p) => p.kind === "agent")
  const pick = (who: string, on: boolean) =>
    setPicked((was) => {
      const next = new Set(was)
      if (on) next.add(who)
      else next.delete(who)
      return next
    })
  const ready = !!name && !problem && !busy
  return (
    <>
      <DialogHead title="New room" sub="A room keeps one conversation apart from #general." onClose={onClose} />
      <form
        className="start-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!ready) return
          setBusy(true)
          const id = await app.actions.addRoom(channel.code, name, only ? [...picked] : undefined)
          if (!id) return setBusy(false)
          onClose()
          go({ to: "where", where: { kind: "room", room: id } })
        }}
      >
        <Field label="Name">
          <span className="room-name">
            <span className="room-hash" aria-hidden="true">
              #
            </span>
            <input
              className="input is-mono"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              maxLength={40}
              placeholder="room-name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-invalid={problem ? true : undefined}
            />
          </span>
        </Field>
        {problem && (
          <p className="start-hint is-error" role="alert">
            {problem}
          </p>
        )}
        <Field label="Who's in">
          <Track className="seg room-who" role="group" aria-label="Who's in">
            <button type="button" aria-pressed={!only} onClick={() => setOnly(false)}>
              Everyone
            </button>
            <button type="button" aria-pressed={only} onClick={() => setOnly(true)}>
              Only who I pick
            </button>
          </Track>
        </Field>
        <p className="start-hint">
          {only ? "It has its own key: only who you pick can read it. Everyone else doesn't see it, and neither does the relay." : "Everyone in the channel, people and agents, sees and reads it."}
        </p>
        {only && (
          <div className="room-pick">
            {[
              ["People", people],
              ["Agents", agents],
            ].map(([title, list]) =>
              typeof title === "string" && Array.isArray(list) && list.length ? (
                <fieldset key={title} className="room-group">
                  <legend>{title}</legend>
                  {list.map((p) => (
                    <label key={p.name} className={cx("room-member", picked.has(p.name) && "is-on")}>
                      <input type="checkbox" checked={picked.has(p.name)} onChange={(e) => pick(p.name, e.target.checked)} />
                      <Avatar person={p} size="sm" />
                      <span className="room-member-name">{shown(p)}</span>
                      {p.role && <span className="room-member-role">{p.role}</span>}
                    </label>
                  ))}
                </fieldset>
              ) : null
            )}
            <RoomReadyNotes people={others.filter((p) => picked.has(p.name))} />
            <p className="start-hint">You're in it too. You can add or remove people later in the room's settings.</p>
          </div>
        )}
        <div className="dialog-foot start-foot">
          <button type="submit" className="btn is-primary" disabled={!ready || (only && picked.size === 0)}>
            {busy ? "Making it…" : only ? `Create private room${picked.size ? ` for ${picked.size + 1}` : ""}` : "Create room"}
          </button>
        </div>
      </form>
    </>
  )
}
