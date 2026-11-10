import "~/i18n/en/modals"
import { Notification01Icon, NotificationOff01Icon } from "@hugeicons/core-free-icons"
import "~/styles/channel-settings.css"
import "~/styles/new-room.css"

import { useEffect, useId, useRef, useState } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { tr } from "~/i18n/rich"
import { autofocus, Avatar, cx, IconButton } from "~/kit/bits"
import { Field, Toggle } from "~/kit/form"
import { Details, Failed, failedToast, failure, rawOf, type Failure } from "~/kit/failed"
import { Modal } from "~/kit/modal"
import { Track } from "~/kit/glide"
import { GlyphIcon, Icon } from "~/kit/icons"
import { choreLine } from "~/github/health"
import { ageOf, ago } from "~/kit/time"
import type { Channel, Room } from "~/model"
import { nickname, roomPeople, seatRoot, shown } from "~/names"
import { useApp, type ChannelTab, useGo } from "~/nav"
import { repoOffers } from "~/modals/repo-offers"
import { LandingPick } from "~/modals/landing-pick"
import { Confirm, Group, InlineEdit, Row } from "~/settings/controls"
import { useAppCan } from "~/live/app-can"
import { isMuted } from "~/live/mute"
import { copyText } from "~/kit/toasts"
import { OutsideLink } from "~/kit/outside"

const REPO = /^[\w.-]+\/[\w.-]+$/

const TABS: readonly (readonly [ChannelTab, Key])[] = [
  ["general", "modals.channel.settings.tab.general"],
  ["rooms", "modals.channel.settings.tab.rooms"],
  ["github", "modals.channel.settings.tab.github"],
  ["notes", "modals.channel.settings.tab.notes"],
]

export function ChannelSettings({ channel, tab: first, onClose }: { channel: Channel; tab?: ChannelTab; onClose: () => void }) {
  const { app, go, toast } = useApp()
  const own = channel.youOwn
  const owner = channel.people.find((p) => p.owner)
  const [ending, setEnding] = useState(false)
  const tabs = TABS.filter(([id]) => id !== "notes" || (channel.facts?.length ?? 0) > 0)
  const [picked, setTab] = useState<ChannelTab>(first ?? "general")
  const tab = tabs.some(([id]) => id === picked) ? picked : "general"
  const sub = own ? t("modals.channel.settings.you.own") : owner ? t("modals.channel.settings.owns.it", { name: shown(owner) }) : undefined

  return (
    <>
      <Modal
        dismiss="x"
        onClose={onClose}
        label={t("modals.channel.settings.label")}
        size="wide"
        className="cset"
        lead={<ChannelIcon channel={channel} own={own} />}
        title={channel.title}
        sub={sub}
        tabs={
          <Track className="seg modal-seg" role="group" aria-label={t("modals.channel.settings.sections")}>
            {tabs.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
                {t(label)}
              </button>
            ))}
          </Track>
        }
      >
        {tab === "general" ? (
          <General channel={channel} onEnd={() => setEnding(true)} />
        ) : tab === "rooms" ? (
          <Rooms channel={channel} />
        ) : tab === "github" ? (
          <GitHub channel={channel} />
        ) : (
          <Facts channel={channel} />
        )}
      </Modal>
      <End
        channel={channel}
        open={ending}
        onClose={() => setEnding(false)}
        onDone={() => {
          setEnding(false)
          if (own) app.actions.closeChannel(channel.code)
          else app.actions.leaveChannel(channel.code)
          const next = app.channels.find((c) => c.code !== channel.code && c.state === "member")
          if (next) go({ to: "channel", code: next.code })
          else onClose()
          toast(own ? t("modals.channel.settings.deleted", { title: channel.title }) : t("modals.channel.settings.left", { title: channel.title }))
        }}
      />
    </>
  )
}

function General({ channel, onEnd }: { channel: Channel; onEnd: () => void }) {
  const { app } = useApp()
  const own = channel.youOwn
  const sets = own || !!channel.youTrusted
  const muted = isMuted(app.prefs.muted, channel.code)
  const [saving, setSaving] = useState<"transcript" | "log" | null>(null)
  const save = (kind: "transcript" | "log") => {
    setSaving(kind)
    void app.actions
      .exportHistory(channel.code, kind)
      .catch((err: unknown) => failedToast(t("modals.channel.settings.history.failed"), err))
      .finally(() => setSaving(null))
  }
  return (
    <>
      {own && (
        <Group title={t("modals.channel.settings.channel")}>
          <Row label={t("modals.channel.settings.name")}>
            <InlineEdit
              value={channel.title}
              label={t("modals.channel.settings.channel.name")}
              verb={t("modals.channel.settings.rename")}
              onSave={(title) => app.actions.renameChannel(channel.code, title)}
            />
          </Row>
          <IconRow channel={channel} />
        </Group>
      )}
      <Group title={t("modals.channel.settings.goal")} hint={t("modals.channel.settings.goal.hint")}>
        {sets ? <GoalEditor channel={channel} /> : <p className="cset-goal">{channel.goal || t("modals.channel.settings.no.goal")}</p>}
      </Group>
      <Group title={t("modals.channel.settings.agents")}>
        <Hold channel={channel} />
        <Row label={t("modals.channel.settings.specs.only")} hint={channel.specsOnly ? t("modals.channel.settings.specs.only.on") : t("modals.channel.settings.specs.only.off")}>
          <Toggle on={!!channel.specsOnly} label={t("modals.channel.settings.specs.only")} disabled={!own} onChange={(next) => app.actions.setSpecsOnly(channel.code, next)} />
        </Row>
      </Group>
      <Group title={t("modals.channel.settings.notifications")}>
        <Row label={t("modals.channel.settings.mute.here")} hint={muted ? t("modals.channel.settings.mute.here.hint") : undefined}>
          <Toggle label={t("modals.channel.settings.mute.channel")} on={muted} onChange={(on) => app.actions.setMute(channel.code, null, on)} />
        </Row>
      </Group>
      <Group title={t("modals.channel.settings.history")}>
        <Row label={t("modals.channel.settings.transcript")} hint={t("modals.channel.settings.transcript.hint")}>
          <button type="button" className="btn is-small" disabled={saving !== null} onClick={() => save("transcript")}>
            <Icon name="download" size={14} />
            {saving === "transcript" ? t("modals.channel.settings.saving") : t("modals.channel.settings.download")}
          </button>
        </Row>
        <Row label={t("modals.channel.settings.signed.log")} hint={t("modals.channel.settings.signed.log.hint")}>
          <button type="button" className="btn is-small" disabled={saving !== null} onClick={() => save("log")}>
            <Icon name="download" size={14} />
            {saving === "log" ? t("modals.channel.settings.saving") : t("modals.channel.settings.download")}
          </button>
        </Row>
      </Group>
      <div className="modal-end">
        <button type="button" className="btn is-quiet is-small" onClick={onEnd}>
          {own ? t("modals.channel.settings.delete.channel.more") : t("modals.channel.settings.leave.channel.more")}
        </button>
      </div>
    </>
  )
}

function IconRow({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const input = useRef<HTMLInputElement>(null)
  return (
    <Row label={t("modals.channel.settings.icon")} hint={t("modals.channel.settings.icon.hint")}>
      {channel.icon && (
        <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.setIcon(channel.code, null)}>
          {t("modals.channel.settings.icon.remove")}
        </button>
      )}
      <button type="button" className="btn is-small" onClick={() => input.current?.click()}>
        {channel.icon ? t("modals.channel.settings.icon.change") : t("modals.channel.settings.icon.choose")}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ""
          if (file) app.actions.setIcon(channel.code, file)
        }}
      />
    </Row>
  )
}

function ChannelIcon({ channel, own }: { channel: Channel; own: boolean }) {
  const { app } = useApp()
  const input = useRef<HTMLInputElement>(null)
  const tile = channel.icon ? <img src={channel.icon} alt="" /> : <span>{channel.title.slice(0, 1).toUpperCase()}</span>
  if (!own)
    return (
      <span className="cset-tile" aria-hidden="true">
        {tile}
      </span>
    )
  return (
    <>
      <button
        type="button"
        className="cset-tile is-button"
        aria-label={channel.icon ? t("modals.channel.settings.image.change") : t("modals.channel.settings.image.choose")}
        title={channel.icon ? t("modals.channel.settings.image.change") : t("modals.channel.settings.image.choose")}
        onClick={() => input.current?.click()}
      >
        {tile}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ""
          if (file) app.actions.setIcon(channel.code, file)
        }}
      />
    </>
  )
}

function GoalEditor({ channel }: { channel: Channel }) {
  const { app, toast } = useApp()
  const [draft, setDraft] = useState(channel.goal ?? "")
  const changed = draft.trim() !== (channel.goal ?? "")
  return (
    <form
      className="cset-goal-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!changed) return
        app.actions.setGoal(channel.code, draft.trim())
        toast(t("modals.channel.settings.goal.saved"))
      }}
    >
      <textarea
        className="textarea"
        aria-label={t("modals.channel.settings.goal")}
        placeholder={t("modals.channel.settings.goal.placeholder")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            e.currentTarget.form?.requestSubmit()
          }
        }}
      />
      {changed && (
        <div className="cset-save">
          <button type="button" className="btn is-quiet is-small" onClick={() => setDraft(channel.goal ?? "")}>
            {t("modals.channel.settings.cancel")}
          </button>
          <button type="submit" className="btn is-small">
            {t("modals.channel.settings.save")}
          </button>
        </div>
      )}
    </form>
  )
}

function Hold({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const hold = channel.hold
  const own = channel.youOwn
  const [note, setNote] = useState(hold?.note ?? "")
  const line = !hold
    ? t("modals.channel.settings.pause.hint")
    : hold.by === channel.you
      ? t("modals.channel.settings.paused.by.you", { when: ago(hold.at) })
      : t("modals.channel.settings.paused.by", { who: nickname(channel, hold.by), when: ago(hold.at) })
  return (
    <div className="cset-hold">
      <Row label={t("modals.channel.settings.pause")} hint={<span className={hold ? "tone-decide" : undefined}>{line}</span>}>
        <Toggle
          label={t("modals.channel.settings.pause")}
          on={!!hold}
          disabled={!own}
          onChange={(on) => {
            app.actions.setHold(channel.code, on, on ? note.trim() || undefined : undefined)
            if (!on) setNote("")
          }}
        />
      </Row>
      {hold && own && (
        <form
          className="cset-hold-note"
          onSubmit={(e) => {
            e.preventDefault()
            if (note.trim() !== (hold.note ?? "")) app.actions.setHold(channel.code, true, note.trim() || undefined)
            e.currentTarget.querySelector("input")?.blur()
          }}
        >
          <input
            className="input"
            aria-label={t("modals.channel.settings.pause.note")}
            placeholder={t("modals.channel.settings.pause.note.placeholder")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </form>
      )}
      {hold && !own && hold.note && <p className="cset-note">{hold.note}</p>}
    </div>
  )
}

function Rooms({ channel }: { channel: Channel }) {
  const go = useGo()
  const sets = channel.youOwn || !!channel.youTrusted
  const rooms = channel.rooms.filter((r) => r.name.trim())
  return (
    <Group title={t("modals.channel.settings.tab.rooms")} hint={t("modals.channel.settings.rooms.hint")}>
      {rooms.map((r) => (
        <RoomRow key={r.id} channel={channel} room={r} sets={sets} />
      ))}
      {sets && (
        <div className="cset-add-row">
          <button type="button" className="btn is-quiet is-small" onClick={() => go({ to: "dialog", dialog: "new-room" })}>
            <Icon name="plus" size={14} />
            {t("modals.channel.settings.new.room")}
          </button>
        </div>
      )}
    </Group>
  )
}

function RoomRow({ channel, room, sets }: { channel: Channel; room: Room; sets: boolean }) {
  const { app } = useApp()
  const [editing, setEditing] = useState<ReadonlySet<string> | null>(null)
  const canChange = useAppCan("changeRoom")
  const mine = seatRoot(channel, channel.you)
  const roots = room.members ? [...new Set(room.members.map((m) => seatRoot(channel, m)))].filter((m) => m !== mine) : []
  const who = room.members
    ? [t("modals.channel.settings.room.you"), ...roots.map((m) => nickname(channel, m))].join(t("modals.channel.settings.room.list.sep"))
    : t("modals.channel.settings.room.everyone")
  return (
    <div className={cx("cset-room", room.muted && "is-muted")}>
      <div className="cset-room-line">
        <span className="cset-room-mark" aria-hidden="true">
          {room.members ? <Icon name="people" size={14} /> : "#"}
        </span>
        <div className="cset-room-text">
          {sets ? (
            <InlineEdit
              value={room.name}
              label={t("modals.channel.settings.room.name", { room: room.name })}
              verb={t("modals.channel.settings.rename")}
              onSave={(name) => app.actions.renameRoom(channel.code, room.id, name)}
            />
          ) : (
            <span className="set-inline-value">{room.name}</span>
          )}
          <span className="cset-room-who" title={who}>
            {who}
          </span>
        </div>
        {room.members && sets && canChange && !editing && (
          <button type="button" className="btn is-quiet is-small cset-on-hover" onClick={() => setEditing(new Set(roots))}>
            {t("modals.channel.settings.room.change.members")}
          </button>
        )}
        <button
          type="button"
          className="icon-btn cset-bell"
          aria-label={room.muted ? t("modals.channel.settings.room.unmute", { room: room.name }) : t("modals.channel.settings.room.mute", { room: room.name })}
          title={room.muted ? t("modals.channel.settings.room.unmute", { room: room.name }) : t("modals.channel.settings.room.mute", { room: room.name })}
          aria-pressed={!!room.muted}
          onClick={() => app.actions.setMute(channel.code, room.id, !room.muted)}
        >
          {room.muted ? <GlyphIcon glyph={NotificationOff01Icon} /> : <GlyphIcon glyph={Notification01Icon} />}
        </button>
      </div>
      {editing && <PickMembers channel={channel} id={room.id} roots={roots} picked={editing} setPicked={setEditing} />}
    </div>
  )
}

function PickMembers({ channel, id, roots, picked, setPicked }: { channel: Channel; id: string; roots: string[]; picked: ReadonlySet<string>; setPicked: (next: ReadonlySet<string> | null) => void }) {
  const { app } = useApp()
  const flip = (name: string, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(name)
    else next.delete(name)
    setPicked(next)
  }
  const out = roots.some((m) => !picked.has(m))
  return (
    <div className="room-pick cset-pick">
      {roomPeople(channel).map((p) => (
        <label key={p.name} className={cx("room-member", picked.has(p.name) && "is-on")}>
          <input type="checkbox" checked={picked.has(p.name)} onChange={(e) => flip(p.name, e.target.checked)} />
          <Avatar person={p} size="sm" />
          <span className="room-member-name">{shown(p)}</span>
        </label>
      ))}
      <p className="cset-hint">{out ? t("modals.channel.settings.room.take.out") : t("modals.channel.settings.room.add")}</p>
      <div className="room-edit-foot">
        <button type="button" className="btn is-quiet is-small" onClick={() => setPicked(null)}>
          {t("modals.channel.settings.cancel")}
        </button>
        <button
          type="button"
          className="btn is-primary is-small"
          onClick={() => {
            void app.actions.setRoomMembers(channel.code, id, [...picked])
            setPicked(null)
          }}
        >
          {t("modals.channel.settings.save")}
        </button>
      </div>
    </div>
  )
}

function GitHub({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const own = channel.youOwn
  const sets = own || !!channel.youTrusted
  const write = !!channel.githubWrite
  const prefix = channel.branchPrefix
  const landing = channel.landing
  return (
    <>
      <Group title={t("modals.channel.settings.repos")} hint={t("modals.channel.settings.repos.hint")}>
        <Repos channel={channel} sets={sets} />
      </Group>
      <Group title={t("modals.channel.settings.access")}>
        <Row label={t("modals.channel.settings.github.write")} hint={write ? t("modals.channel.settings.github.write.on") : t("modals.channel.settings.github.write.off")}>
          <Toggle on={write} label={t("modals.channel.settings.github.write")} disabled={!own} onChange={(on) => app.actions.setGithubWrite(channel.code, on)} />
        </Row>
        <Row label={t("modals.channel.settings.branch.prefix")} hint={prefix ? t("modals.channel.settings.branch.prefix.set", { prefix }) : t("modals.channel.settings.branch.prefix.none")}>
          {sets ? (
            <span className="cset-prefix">
              {prefix && (
                <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.setBranchPrefix(channel.code, null)}>
                  {t("modals.channel.settings.clear")}
                </button>
              )}
              <InlineEdit
                value={prefix ?? ""}
                label={t("modals.channel.settings.branch.prefix")}
                verb={prefix ? t("modals.channel.settings.change") : t("modals.channel.settings.set")}
                onSave={(v) => app.actions.setBranchPrefix(channel.code, v)}
              />
            </span>
          ) : (
            <span className="cset-mono">{prefix ?? t("modals.channel.settings.none")}</span>
          )}
        </Row>
        <Row label={t("modals.channel.settings.landing")} hint={landing ? t("modals.channel.settings.landing.set", { landing }) : t("modals.channel.settings.landing.none")}>
          {sets ? (
            <LandingPick value={landing} onPick={(then) => app.actions.setLanding(channel.code, then)} />
          ) : (
            <span className="cset-mono">{landing ?? t("modals.channel.settings.landing.approval")}</span>
          )}
        </Row>
        <Row label={t("modals.channel.settings.people.merge")} hint={channel.peopleMerge ? t("modals.channel.settings.people.merge.on") : t("modals.channel.settings.people.merge.off")}>
          <Toggle on={!!channel.peopleMerge} label={t("modals.channel.settings.people.merge")} disabled={!sets} onChange={(on) => app.actions.setPeopleMerge(channel.code, on)} />
        </Row>
      </Group>
    </>
  )
}

function Repos({ channel, sets }: { channel: Channel; sets: boolean }) {
  const { app } = useApp()
  const [draft, setDraft] = useState("")
  const [mine, setMine] = useState<string[]>([])
  const [offers, setOffers] = useState<Failure | null>(null)
  const valid = REPO.test(draft.trim())
  const listId = useId()
  useEffect(() => {
    if (!sets) return
    let live = true
    void app.actions.myRepos().then(
      (r) => live && setMine(r),
      (err: unknown) => live && setOffers(repoFailure(err))
    )
    return () => {
      live = false
    }
  }, [app.actions, sets])
  const [removing, setRemoving] = useState<string | null>(null)
  const offer = repoOffers(mine, channel.repos)
  return (
    <>
      {channel.repos.map((r) => (
        <div key={r} className="cset-repo">
          <Icon name="github" size={14} />
          <OutsideLink className="cset-repo-name" href={`https://github.com/${r}`}>
            {r}
          </OutsideLink>
          {sets && <IconButton icon="close" label={t("modals.channel.settings.repo.remove", { repo: r })} onClick={() => setRemoving(r)} />}
        </div>
      ))}
      <Confirm
        open={removing !== null}
        title={t("modals.channel.settings.repo.remove.ask", { repo: removing ?? "", channel: channel.title })}
        sub={t("modals.channel.settings.repo.remove.sub")}
        action={t("modals.channel.settings.repo.remove.yes")}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) app.actions.removeRepo(channel.code, removing)
          setRemoving(null)
        }}
      />
      {!sets && !channel.repos.length && <p className="set-none">{t("modals.channel.settings.no.repos")}</p>}
      {sets && (
        <form
          className="cset-repo cset-repo-add"
          onSubmit={(e) => {
            e.preventDefault()
            if (!valid) return
            app.actions.addRepo(channel.code, draft.trim())
            setDraft("")
          }}
        >
          <input
            className="input is-mono"
            placeholder={t("modals.channel.settings.repo.placeholder")}
            aria-label={t("modals.channel.settings.repo.add.label")}
            list={listId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <datalist id={listId}>
            {offer.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <button type="submit" className="btn is-small" disabled={!valid}>
            {t("modals.channel.settings.repo.add")}
          </button>
        </form>
      )}
      {sets && offers && <Failed failure={offers} />}
      <GithubTrouble channel={channel} />
    </>
  )
}

function repoFailure(err: unknown): Failure | null {
  if (/link GitHub/i.test(rawOf(err))) return null
  const expired = /expired/i.test(rawOf(err))
  return failure(t("modals.channel.settings.repos.failed"), err, { other: t(expired ? "modals.channel.settings.repos.expired" : "modals.channel.settings.repos.type") })
}

function GithubTrouble({ channel }: { channel: Channel }) {
  const health = channel.github
  if (!health) return null
  const missing = (health.status?.repos ?? []).filter((r) => r.installed === false)
  if (!missing.length && !health.errors.length) return null
  return (
    <ul className="cset-trouble">
      {missing.map((r) => (
        <li key={`install:${r.repo}`}>
          {tr("modals.channel.settings.app.missing", {
            account: r.repo.split("/")[0],
            repo: r.repo,
            install: r.install ? <OutsideLink href={r.install}>{t("modals.channel.settings.app.install")}</OutsideLink> : null,
          })}
        </li>
      ))}
      {health.errors.map((e) => (
        <li key={`${e.what}:${e.repo ?? ""}`}>
          {choreLine(e)}
          <Details raw={e.message} />
        </li>
      ))}
    </ul>
  )
}

function Facts({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const [clearing, setClearing] = useState<string | null>(null)
  return (
    <Group title={t("modals.channel.settings.tab.notes")} hint={t("modals.channel.settings.notes.hint")}>
      {(channel.facts ?? []).map((f) => (
        <div key={f.key} className="cset-fact">
          <button
            type="button"
            className="cset-fact-body"
            title={
              ageOf(f.at) === "now"
                ? t("modals.channel.settings.note.copy.now", { who: nickname(channel, f.by) })
                : t("modals.channel.settings.note.copy.ago", { who: nickname(channel, f.by), time: ago(f.at) })
            }
            onClick={() => copyText(f.value, t("modals.channel.settings.note.copied", { key: f.key }))}
          >
            <span className="cset-fact-key">{f.key}</span>
            <span className="cset-fact-value">{f.value}</span>
          </button>
          {clearing === f.key ? (
            <span className="cset-fact-confirm">
              <button type="button" className="btn is-quiet is-small" autoFocus onClick={() => setClearing(null)}>
                {t("modals.channel.settings.note.keep")}
              </button>
              <button type="button" className="btn is-danger is-small" onClick={() => (app.actions.clearFact(channel.code, f.key), setClearing(null))}>
                {t("modals.channel.settings.clear")}
              </button>
            </span>
          ) : (
            <span className="cset-on-hover">
              <IconButton icon="close" label={t("modals.channel.settings.note.clear", { key: f.key })} onClick={() => setClearing(f.key)} />
            </span>
          )}
        </div>
      ))}
    </Group>
  )
}

function End({ channel, open, onClose, onDone }: { channel: Channel; open: boolean; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState("")
  const close = () => {
    setTyped("")
    onClose()
  }
  if (!channel.youOwn)
    return (
      <Confirm
        open={open}
        title={t("modals.channel.settings.leave.title", { title: channel.title })}
        sub={t("modals.channel.settings.leave.sub")}
        action={t("modals.channel.settings.leave")}
        onClose={close}
        onConfirm={onDone}
      />
    )
  return (
    <Confirm
      open={open}
      title={t("modals.channel.settings.delete.title", { title: channel.title })}
      sub={t("modals.channel.settings.delete.sub")}
      action={t("modals.channel.settings.delete.channel")}
      ready={typed.trim() === channel.title}
      onClose={close}
      onConfirm={onDone}
    >
      <Field label={t("modals.channel.settings.delete.type", { title: channel.title })}>
        <input ref={autofocus} className="input is-mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Field>
    </Confirm>
  )
}
