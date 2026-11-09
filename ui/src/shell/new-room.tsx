import "~/i18n/en/shell-later"
import "~/styles/new-room.css"

import { useState } from "react"

import { roomProblem } from "@kiwi/app/rooms.ts"
import { autofocus, Avatar, cx } from "~/kit/bits"
import { Failed, failure, type Failure } from "~/kit/failed"
import { Modal } from "~/kit/modal"
import { Track } from "~/kit/glide"
import type { Channel } from "~/model"
import { useApp } from "~/nav"
import { roomPeople, shown } from "~/names"
import { useAppCan } from "~/live/app-can"
import { t } from "~/i18n/i18n"

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
  const [failed, setFailed] = useState<Failure | null>(null)
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
    <Modal dismiss="x" onClose={onClose} label={t("shell.new.room.title")} title={t("shell.new.room.title")}>
      <form
        className="room-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!ready) return
          setBusy(true)
          setFailed(null)
          let id: string
          try {
            id = await app.actions.addRoom(channel.code, name, only ? [...picked] : undefined)
          } catch (err) {
            // The form stays open with what went wrong under it, so the person can try again.
            setFailed(failure(t("shell.new.room.failed"), err))
            return setBusy(false)
          }
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
            placeholder={t("shell.new.room.placeholder")}
            aria-label={t("shell.new.room.name")}
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
        <Track className="seg room-who" role="group" aria-label={t("shell.new.room.who")}>
          <button type="button" aria-pressed={!only} onClick={() => setOnly(false)}>
            {t("shell.new.room.everyone")}
          </button>
          <button type="button" aria-pressed={only} disabled={!canPick} title={canPick ? undefined : t("shell.new.room.update.to.pick")} onClick={() => setOnly(true)}>
            {t("shell.new.room.members.only")}
          </button>
        </Track>
        {only && <p className="room-hint">{t("shell.new.room.members.hint")}</p>}
        {only && (
          <div className="room-pick">
            {[
              [t("shell.new.room.people"), people],
              [t("shell.new.room.agents"), agents],
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
        {failed && <Failed failure={failed} />}
        <div className="modal-foot">
          <button type="submit" className="btn is-primary" disabled={!ready || (only && picked.size === 0)}>
            {busy
              ? t("shell.new.room.making")
              : only
                ? picked.size
                  ? t("shell.new.room.create.members.for", { count: picked.size + 1 })
                  : t("shell.new.room.create.members")
                : t("shell.new.room.create")}
          </button>
        </div>
      </form>
    </Modal>
  )
}
