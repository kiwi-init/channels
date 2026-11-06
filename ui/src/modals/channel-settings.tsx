import { Notification01Icon, NotificationOff01Icon } from "@hugeicons/core-free-icons"
import "~/styles/channel-settings.css"
import "~/styles/new-room.css"

import { useEffect, useId, useRef, useState } from "react"

import { autofocus, Avatar, cx, IconButton } from "~/kit/bits"
import { Field, Toggle } from "~/kit/form"
import { Modal } from "~/kit/modal"
import { Track } from "~/kit/glide"
import { GlyphIcon, Icon } from "~/kit/icons"
import { choreLine } from "~/github/health"
import { ago } from "~/kit/time"
import type { Channel, Room } from "~/model"
import { nickname, roomPeople, seatRoot, shown } from "~/names"
import { useApp, type ChannelTab } from "~/nav"
import { repoOffers } from "~/modals/repo-offers"
import { Confirm, Group, InlineEdit, Row } from "~/settings/controls"
import { useAppCan } from "~/live/app-can"
import { isMuted } from "~/live/mute"
import { copyText } from "~/kit/toasts"
import { OutsideLink } from "~/kit/outside"

const REPO = /^[\w.-]+\/[\w.-]+$/

const TABS: readonly (readonly [ChannelTab, string])[] = [
  ["general", "General"],
  ["rooms", "Rooms"],
  ["github", "GitHub"],
  ["notes", "Notes"],
]

export function ChannelSettings({ channel, tab: first, onClose }: { channel: Channel; tab?: ChannelTab; onClose: () => void }) {
  const { app, go, toast } = useApp()
  const own = channel.youOwn
  const owner = channel.people.find((p) => p.owner)
  const [ending, setEnding] = useState(false)
  const tabs = TABS.filter(([id]) => id !== "notes" || (channel.facts?.length ?? 0) > 0)
  const [picked, setTab] = useState<ChannelTab>(first ?? "general")
  const tab = tabs.some(([id]) => id === picked) ? picked : "general"
  const sub = own ? "You own this channel" : owner ? `${shown(owner)} owns it` : undefined

  return (
    <>
      <Modal
        dismiss="x"
        onClose={onClose}
        label="Channel settings"
        size="wide"
        className="cset"
        lead={<ChannelIcon channel={channel} own={own} />}
        title={channel.title}
        sub={sub}
        tabs={
          <Track className="seg modal-seg" role="group" aria-label="Sections">
            {tabs.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
                {label}
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
          toast(own ? `Deleted ${channel.title}` : `Left ${channel.title}`)
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
    void app.actions.exportHistory(channel.code, kind).finally(() => setSaving(null))
  }
  return (
    <>
      {own && (
        <Group title="Channel">
          <Row label="Name">
            <InlineEdit value={channel.title} label="Channel name" verb="Rename" onSave={(title) => app.actions.renameChannel(channel.code, title)} />
          </Row>
          <IconRow channel={channel} />
        </Group>
      )}
      <Group title="Goal" hint="What this channel is for and what done looks like. Every agent reads it first.">
        {sets ? <GoalEditor channel={channel} /> : <p className="cset-goal">{channel.goal || "No goal yet."}</p>}
      </Group>
      <Group title="Agents">
        <Hold channel={channel} />
        <Row
          label="Tasks only from approved specs"
          hint={channel.specsOnly ? "Every task is a step of a spec a person approved; the first free agent starts it." : "Agents may file tasks under any person's message."}
        >
          <Toggle on={!!channel.specsOnly} label="Tasks only from approved specs" disabled={!own} onChange={(next) => app.actions.setSpecsOnly(channel.code, next)} />
        </Row>
      </Group>
      <Group title="Notifications">
        <Row label="Mute on this computer" hint={muted ? "Its unread count shows only mentions of you." : undefined}>
          <Toggle label="Mute this channel" on={muted} onChange={(on) => app.actions.setMute(channel.code, null, on)} />
        </Row>
      </Group>
      <Group title="History">
        <Row label="Transcript" hint="Markdown, readable anywhere">
          <button type="button" className="btn is-small" disabled={saving !== null} onClick={() => save("transcript")}>
            <Icon name="download" size={14} />
            {saving === "transcript" ? "Saving…" : "Download"}
          </button>
        </Row>
        <Row label="Signed log" hint="JSON lines, every message signed">
          <button type="button" className="btn is-small" disabled={saving !== null} onClick={() => save("log")}>
            <Icon name="download" size={14} />
            {saving === "log" ? "Saving…" : "Download"}
          </button>
        </Row>
      </Group>
      <div className="modal-end">
        <button type="button" className="btn is-quiet is-small" onClick={onEnd}>
          {own ? "Delete channel…" : "Leave this channel…"}
        </button>
      </div>
    </>
  )
}

function IconRow({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const input = useRef<HTMLInputElement>(null)
  return (
    <Row label="Icon" hint="Shown on its tile in the rail.">
      {channel.icon && (
        <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.setIcon(channel.code, null)}>
          Remove
        </button>
      )}
      <button type="button" className="btn is-small" onClick={() => input.current?.click()}>
        {channel.icon ? "Change…" : "Choose…"}
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
        aria-label={channel.icon ? "Change image…" : "Choose an image…"}
        title={channel.icon ? "Change image…" : "Choose an image…"}
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
        toast("Goal saved")
      }}
    >
      <textarea
        className="textarea"
        aria-label="Goal"
        placeholder="Ship the beta by Friday, with the onboarding flow tested on a fresh Mac."
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
            Cancel
          </button>
          <button type="submit" className="btn is-small">
            Save
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
  const by = hold ? (hold.by === channel.you ? "you" : nickname(channel, hold.by)) : ""
  const line = hold ? `Paused by ${by} · ${ago(hold.at)}` : "Agents keep reading but don't act until you resume."
  return (
    <div className="cset-hold">
      <Row label="Pause agents" hint={<span className={hold ? "tone-decide" : undefined}>{line}</span>}>
        <Toggle
          label="Pause agents"
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
          <input className="input" aria-label="Note for the agents" placeholder="A note for the agents, Enter to save" value={note} onChange={(e) => setNote(e.target.value)} />
        </form>
      )}
      {hold && !own && hold.note && <p className="cset-note">{hold.note}</p>}
    </div>
  )
}

function Rooms({ channel }: { channel: Channel }) {
  const { go } = useApp()
  const sets = channel.youOwn || !!channel.youTrusted
  const rooms = channel.rooms.filter((r) => r.name.trim())
  return (
    <Group title="Rooms" hint="Muting a room keeps it out of your unread counts on this computer.">
      {rooms.map((r) => (
        <RoomRow key={r.id} channel={channel} room={r} sets={sets} />
      ))}
      {sets && (
        <div className="cset-add-row">
          <button type="button" className="btn is-quiet is-small" onClick={() => go({ to: "dialog", dialog: "new-room" })}>
            <Icon name="plus" size={14} />
            New room
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
  const who = room.members ? ["you", ...roots.map((m) => nickname(channel, m))].join(", ") : "Everyone"
  return (
    <div className={cx("cset-room", room.muted && "is-muted")}>
      <div className="cset-room-line">
        <span className="cset-room-mark" aria-hidden="true">
          {room.members ? <Icon name="people" size={14} /> : "#"}
        </span>
        <div className="cset-room-text">
          {sets ? (
            <InlineEdit value={room.name} label={`Name of #${room.name}`} verb="Rename" onSave={(name) => app.actions.renameRoom(channel.code, room.id, name)} />
          ) : (
            <span className="set-inline-value">{room.name}</span>
          )}
          <span className="cset-room-who" title={who}>
            {who}
          </span>
        </div>
        {room.members && sets && canChange && !editing && (
          <button type="button" className="btn is-quiet is-small cset-on-hover" onClick={() => setEditing(new Set(roots))}>
            Change who's in
          </button>
        )}
        <button
          type="button"
          className="icon-btn cset-bell"
          aria-label={room.muted ? `Unmute #${room.name}` : `Mute #${room.name}`}
          title={room.muted ? `Unmute #${room.name}` : `Mute #${room.name}`}
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
      <p className="cset-hint">{out ? "Whoever you take out keeps what they could read, and nothing after: the room moves to a new key." : "Whoever you add reads the room's history."}</p>
      <div className="room-edit-foot">
        <button type="button" className="btn is-quiet is-small" onClick={() => setPicked(null)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn is-primary is-small"
          onClick={() => {
            void app.actions.setRoomMembers(channel.code, id, [...picked])
            setPicked(null)
          }}
        >
          Save
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
      <Group title="Repos" hint="Pull requests and issues from these show on the channel's GitHub tab and on their tasks.">
        <Repos channel={channel} sets={sets} />
      </Group>
      <Group title="Access">
        <Row label="Write to GitHub" hint={write ? "Kiwi links new PRs and issues to their tasks, and a task closing closes its issue." : "Kiwi doesn't comment on or close anything in your repos."}>
          <Toggle on={write} label="Write to GitHub" disabled={!own} onChange={(on) => app.actions.setGithubWrite(channel.code, on)} />
        </Row>
        <Row
          label="Branch prefix"
          hint={prefix ? `A branch named ${prefix}7-… shows its pull request on T7.` : "With one, a branch named with it and a task's number shows its pull request on that task."}
        >
          {sets ? (
            <span className="cset-prefix">
              {prefix && (
                <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.setBranchPrefix(channel.code, null)}>
                  Clear
                </button>
              )}
              <InlineEdit value={prefix ?? ""} label="Branch prefix" verb={prefix ? "Change" : "Set"} onSave={(v) => app.actions.setBranchPrefix(channel.code, v)} />
            </span>
          ) : (
            <span className="cset-mono">{prefix ?? "None"}</span>
          )}
        </Row>
        <Row
          label="Tasks land on"
          hint={
            landing
              ? `An approved task stays landing until its ${landing} has happened; a task can set its own with --then.`
              : "Approval finishes a task. Set merge, release:tag, release:npm:PKG@RANGE or run to keep it open until that has happened."
          }
        >
          {sets ? (
            <span className="cset-prefix">
              {landing && (
                <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.setLanding(channel.code, null)}>
                  Clear
                </button>
              )}
              <InlineEdit value={landing ?? ""} label="Tasks land on" verb={landing ? "Change" : "Set"} onSave={(v) => app.actions.setLanding(channel.code, v)} />
            </span>
          ) : (
            <span className="cset-mono">{landing ?? "Approval"}</span>
          )}
        </Row>
        <Row
          label="People merge"
          hint={
            channel.peopleMerge
              ? "Agents leave pull requests for a person to merge once the task is approved and its checks are green."
              : "Agents merge their own pull requests once the task is approved and its checks are green."
          }
        >
          <Toggle on={!!channel.peopleMerge} label="People merge" disabled={!sets} onChange={(on) => app.actions.setPeopleMerge(channel.code, on)} />
        </Row>
      </Group>
    </>
  )
}

function Repos({ channel, sets }: { channel: Channel; sets: boolean }) {
  const { app } = useApp()
  const [draft, setDraft] = useState("")
  const [mine, setMine] = useState<string[]>([])
  const valid = REPO.test(draft.trim())
  const listId = useId()
  useEffect(() => {
    if (!sets) return
    let live = true
    void app.actions.myRepos().then((r) => live && setMine(r))
    return () => {
      live = false
    }
  }, [app.actions, sets])
  const offer = repoOffers(mine, channel.repos)
  return (
    <>
      {channel.repos.map((r) => (
        <div key={r} className="cset-repo">
          <Icon name="github" size={14} />
          <OutsideLink className="cset-repo-name" href={`https://github.com/${r}`}>
            {r}
          </OutsideLink>
          {sets && <IconButton icon="close" label={`Remove ${r}`} onClick={() => app.actions.removeRepo(channel.code, r)} />}
        </div>
      ))}
      {!sets && !channel.repos.length && <p className="set-none">No repos yet.</p>}
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
          <input className="input is-mono" placeholder="owner/repo" aria-label="Add a repo" list={listId} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <datalist id={listId}>
            {offer.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          <button type="submit" className="btn is-small" disabled={!valid}>
            Add
          </button>
        </form>
      )}
      <GithubTrouble channel={channel} />
    </>
  )
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
          Kiwi Channels isn't installed on {r.repo.split("/")[0]}, so GitHub sends {r.repo} nothing. {r.install && <OutsideLink href={r.install}>Install it</OutsideLink>}
        </li>
      ))}
      {health.errors.map((e) => (
        <li key={`${e.what}:${e.repo ?? ""}`}>{choreLine(e)}</li>
      ))}
    </ul>
  )
}

function Facts({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const [clearing, setClearing] = useState<string | null>(null)
  return (
    <Group title="Notes" hint="What agents noted for everyone here. Click one to copy its value.">
      {(channel.facts ?? []).map((f) => (
        <div key={f.key} className="cset-fact">
          <button
            type="button"
            className="cset-fact-body"
            title={`Copy the value. Noted by ${nickname(channel, f.by)} ${ago(f.at) === "now" ? "just now" : `${ago(f.at)} ago`}.`}
            onClick={() => copyText(f.value, `Copied ${f.key}`)}
          >
            <span className="cset-fact-key">{f.key}</span>
            <span className="cset-fact-value">{f.value}</span>
          </button>
          {clearing === f.key ? (
            <span className="cset-fact-confirm">
              <button type="button" className="btn is-quiet is-small" onClick={() => setClearing(null)}>
                Keep
              </button>
              <button type="button" className="btn is-danger is-small" onClick={() => (app.actions.clearFact(channel.code, f.key), setClearing(null))}>
                Clear
              </button>
            </span>
          ) : (
            <span className="cset-on-hover">
              <IconButton icon="close" label={`Clear ${f.key}`} onClick={() => setClearing(f.key)} />
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
      <Confirm open={open} title={`Leave ${channel.title}?`} sub="You stop getting its messages. To come back, someone has to let you in again." action="Leave" onClose={close} onConfirm={onDone} />
    )
  return (
    <Confirm
      open={open}
      title={`Delete ${channel.title}?`}
      sub="Every message, room, DM, task, spec and note is deleted for everyone, every person and agent is removed, and its invites stop working. This can't be undone: download the history first if you want a copy."
      action="Delete channel"
      ready={typed.trim() === channel.title}
      onClose={close}
      onConfirm={onDone}
    >
      <Field label={`Type ${channel.title} to confirm`}>
        <input ref={autofocus} className="input is-mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Field>
    </Confirm>
  )
}
