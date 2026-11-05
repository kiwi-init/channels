import "~/styles/new-room.css"

import { useState } from "react"

import { roomProblem } from "@kiwi/app/rooms.ts"
import { autofocus, Avatar, cx, Modal } from "~/kit/bits"
import { Track } from "~/kit/glide"
import type { Channel } from "~/model"
import { useApp } from "~/nav"
import { roomPeople, shown } from "~/names"
import { useAppCan } from "~/live/app-can"

const roomName = (typed: string): string => typed.trim().replace(/^#/, "").trim().toLowerCase().replace(/\s+/g, "-")

export function NewRoomDialog({ channel }: { channel: Channel }) {
  const { go } = useApp()
  return <NewRoomForm channel={channel} onClose={() => go({ to: "dialog", dialog: null })} />
}

function NewRoomForm({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { app, go } = useApp()
  const [typed, setTyped] = useState("")
  const [wantsOnly, setOnly] = useState(false)
  const canPick = useAppCan("makeRoom")
  const only = wantsOnly && canPick
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const name = roomName(typed)
  const problem = name ? roomProblem(channel.rooms, name) : null
  const others = roomPeople(channel)
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
    <Modal dismiss="x" onClose={onClose} label="New room" title="New room">
      <form
        className="room-form"
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
        <span className="room-name">
          <span className="room-hash" aria-hidden="true">
            #
          </span>
          <input
            className="input is-mono"
            ref={autofocus}
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            placeholder="room-name"
            aria-label="Room name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-invalid={problem ? true : undefined}
          />
        </span>
        {problem && (
          <p className="room-hint is-error" role="alert">
            {problem}
          </p>
        )}
        <Track className="seg room-who" role="group" aria-label="Who's in">
          <button type="button" aria-pressed={!only} onClick={() => setOnly(false)}>
            Everyone
          </button>
          <button type="button" aria-pressed={only} disabled={!canPick} title={canPick ? undefined : "Update Channels to make members-only rooms"} onClick={() => setOnly(true)}>
            Members only
          </button>
        </Track>
        {only && <p className="room-hint">Only its members are sent what's said here. Anyone in the channel can still open it.</p>}
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
          </div>
        )}
        <div className="modal-foot">
          <button type="submit" className="btn is-primary" disabled={!ready || (only && picked.size === 0)}>
            {busy ? "Making it…" : only ? `Create members-only room${picked.size ? ` for ${picked.size + 1}` : ""}` : "Create room"}
          </button>
        </div>
      </form>
    </Modal>
  )
}
