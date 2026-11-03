import { Notification01Icon } from "@hugeicons/core-free-icons"
import "~/styles/channel-panel.css"
import "~/styles/new-room.css"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"

import { Avatar, cx, Field, Heading, IconButton } from "~/kit/bits"
import { NotificationOff01Icon } from "@hugeicons/core-free-icons"
import { GlyphIcon, Icon } from "~/kit/icons"
import { choreLine } from "~/github/health"
import { ago } from "~/kit/time"
import type { Channel } from "~/model"
import { nickname, roomPeople, seatRoot, shown } from "~/names"
import { useApp } from "~/nav"
import { PanelHead } from "~/panels/frame"
import { repoOffers } from "~/panels/repo-offers"
import { Toggle } from "~/kit/bits"
import { Confirm, InlineEdit } from "~/settings/controls"
import { useAppCan } from "~/live/app-can"
import { isMuted } from "~/live/quiet"
import { copyText } from "~/kit/toasts"

const REPO = /^[\w.-]+\/[\w.-]+$/

export function ChannelPanel({ channel }: { channel: Channel }) {
  const { app, go, toast } = useApp()
  const { actions } = app
  const own = channel.youOwn
  const sets = own || !!channel.youTrusted
  const owner = channel.people.find((p) => p.owner && !p.you)
  const [ending, setEnding] = useState(false)

  const [saving, setSaving] = useState<"transcript" | "log" | null>(null)
  const save = (kind: "transcript" | "log") => {
    setSaving(kind)
    void actions.exportHistory(channel.code, kind).finally(() => setSaving(null))
  }

  return (
    <>
      <PanelHead title={<span className="sr">Channel settings</span>} />
      <div className="panel-body cpanel">
        <section className="cpanel-id" aria-label="Name and icon">
          <ChannelIcon channel={channel} own={own} />
          <div className="cpanel-id-text">
            {own ? (
              <InlineEdit value={channel.title} label="Channel name" verb="Rename" onSave={(title) => actions.renameChannel(channel.code, title)} />
            ) : (
              <p className="cpanel-name">{channel.title}</p>
            )}
            {!own && owner && <p className="cpanel-hint">{shown(owner)} owns it</p>}
          </div>
        </section>

        <MuteChannel channel={channel} />

        <Part title="Rooms">
          <Rooms channel={channel} own={sets} />
        </Part>

        <Part title="Goal">{sets ? <GoalEditor channel={channel} /> : channel.goal ? <p className="cpanel-goal">{channel.goal}</p> : <p className="cpanel-none">No goal yet.</p>}</Part>

        <Part title="Agents">
          <Hold channel={channel} />
          <SpecsOnly channel={channel} own={own} />
        </Part>

        <Part title="GitHub">
          <Repos channel={channel} />
          {(sets ? channel.repos.length > 0 : channel.githubWrite || channel.branchPrefix) && <GitHub channel={channel} own={own} sets={sets} />}
        </Part>

        {(channel.facts?.length ?? 0) > 0 && (
          <Part title="Notes">
            <Facts channel={channel} />
          </Part>
        )}

        <Part title="History">
          <div className="cpanel-downloads">
            <button type="button" className="btn is-quiet is-small" title="Markdown, readable anywhere" disabled={saving !== null} onClick={() => save("transcript")}>
              <Icon name="download" size={14} />
              {saving === "transcript" ? "Saving…" : "Transcript"}
            </button>
            <button type="button" className="btn is-quiet is-small" title="JSON lines, every message signed" disabled={saving !== null} onClick={() => save("log")}>
              <Icon name="download" size={14} />
              {saving === "log" ? "Saving…" : "Signed log"}
            </button>
          </div>
        </Part>

        <div className="cpanel-end">
          <button type="button" className="btn is-quiet is-small" onClick={() => setEnding(true)}>
            {own ? "Delete channel…" : "Leave this channel…"}
          </button>
        </div>
      </div>
      <End
        channel={channel}
        open={ending}
        onClose={() => setEnding(false)}
        onDone={() => {
          setEnding(false)
          if (own) actions.closeChannel(channel.code)
          else actions.leaveChannel(channel.code)
          const next = app.channels.find((c) => c.code !== channel.code && c.state === "member")
          if (next) go({ to: "channel", code: next.code })
          else go({ to: "panel", panel: null })
          toast(own ? `Deleted ${channel.title}` : `Left ${channel.title}`)
        }}
      />
    </>
  )
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel-section cpanel-part" aria-label={title}>
      <Heading>{title}</Heading>
      {children}
    </section>
  )
}

function GoalEditor({ channel }: { channel: Channel }) {
  const { app, toast } = useApp()
  const [draft, setDraft] = useState(channel.goal ?? "")
  const changed = draft.trim() !== (channel.goal ?? "")
  return (
    <form
      className="cpanel-goal-form"
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
        placeholder="What this channel is for and what done looks like. Every agent reads it first."
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
        <div className="cpanel-save">
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

function Repos({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const own = channel.youOwn || !!channel.youTrusted
  const [draft, setDraft] = useState("")
  const [mine, setMine] = useState<string[]>([])
  const valid = REPO.test(draft.trim())
  const listId = useId()
  useEffect(() => {
    if (!own) return
    let live = true
    void app.actions.myRepos().then((r) => live && setMine(r))
    return () => {
      live = false
    }
  }, [app.actions, own])
  const offer = repoOffers(mine, channel.repos)
  return (
    <>
      {channel.repos.length > 0 ? (
        <ul className="cpanel-list">
          {channel.repos.map((r) => (
            <li key={r} className="cpanel-item">
              <a className="cpanel-repo" href={`https://github.com/${r}`} target="_blank" rel="noreferrer">
                {r}
              </a>
              {own && <IconButton icon="close" label={`Remove ${r}`} onClick={() => app.actions.removeRepo(channel.code, r)} />}
            </li>
          ))}
        </ul>
      ) : (
        !own && <p className="cpanel-none">No repos yet.</p>
      )}
      {channel.github && <GithubTrouble channel={channel} />}
      {own && (
        <form
          className="cpanel-add"
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
    </>
  )
}

function GithubTrouble({ channel }: { channel: Channel }) {
  const health = channel.github
  if (!health) return null
  const missing = (health.status?.repos ?? []).filter((r) => r.installed === false)
  if (!missing.length && !health.errors.length) return null
  return (
    <ul className="cpanel-list cpanel-gh-trouble">
      {missing.map((r) => (
        <li key={`install:${r.repo}`} className="cpanel-note">
          Kiwi Channels isn't installed on {r.repo.split("/")[0]}, so GitHub sends {r.repo} nothing.{" "}
          {r.install && (
            <a href={r.install} target="_blank" rel="noreferrer">
              Install it
            </a>
          )}
        </li>
      ))}
      {health.errors.map((e) => (
        <li key={`${e.what}:${e.repo ?? ""}`} className="cpanel-note">
          {choreLine(e)}
        </li>
      ))}
    </ul>
  )
}

function Hold({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const hold = channel.hold
  const own = channel.youOwn
  const [note, setNote] = useState(hold?.note ?? "")
  const by = hold ? (hold.by === channel.you ? "you" : nickname(channel, hold.by)) : ""

  if (!own)
    return hold ? (
      <div className="cpanel-held">
        <p className="cpanel-held-line">
          Paused by {by} · {ago(hold.at)}
        </p>
        {hold.note && <p className="cpanel-note">{hold.note}</p>}
      </div>
    ) : null

  return (
    <div className="cpanel-hold">
      <div className="cpanel-row" title="Agents keep reading but don't act until you resume.">
        <span className="cpanel-value">Pause agents</span>
        <Toggle
          label="Pause agents"
          on={!!hold}
          onChange={(on) => {
            app.actions.setHold(channel.code, on, on ? note.trim() || undefined : undefined)
            if (!on) setNote("")
          }}
        />
      </div>
      {hold && (
        <form
          className="cpanel-held"
          onSubmit={(e) => {
            e.preventDefault()
            if (note.trim() !== (hold.note ?? "")) app.actions.setHold(channel.code, true, note.trim() || undefined)
            e.currentTarget.querySelector("input")?.blur()
          }}
        >
          <p className="cpanel-held-line">
            Paused by {by} · {ago(hold.at)}
          </p>
          <input className="input" aria-label="Note for the agents" placeholder="A note for the agents, Enter to save" value={note} onChange={(e) => setNote(e.target.value)} />
        </form>
      )}
    </div>
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
        <input autoFocus className="input is-mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Field>
    </Confirm>
  )
}

function SpecsOnly({ channel, own }: { channel: Channel; own: boolean }) {
  const { app } = useApp()
  const on = !!channel.specsOnly
  return (
    <div
      className="cpanel-row"
      title={
        on
          ? "Every task is a step of a spec a person approved. Agents write the spec with you; once it's approved, the first free agent starts it."
          : "Agents may file tasks under any person's message. Turn it on, and work starts only from a spec a person approved."
      }
    >
      <span className="cpanel-value">Tasks only from approved specs</span>
      {own ? <Toggle on={on} label="Tasks only from approved specs" onChange={(next) => app.actions.setSpecsOnly(channel.code, next)} /> : <span className="cpanel-state">{on ? "on" : "off"}</span>}
    </div>
  )
}

function GitHub({ channel, own, sets }: { channel: Channel; own: boolean; sets: boolean }) {
  const { app } = useApp()
  const write = !!channel.githubWrite
  const prefix = channel.branchPrefix
  return (
    <div className="cpanel-github">
      <div className="cpanel-row" title={write ? "Kiwi links new PRs and issues to their tasks, and a task closing closes its issue." : "Kiwi doesn't comment on or close anything in your repos."}>
        <span className="cpanel-value">Write to GitHub</span>
        {own ? <Toggle on={write} label="Write to GitHub" onChange={(on) => app.actions.setGithubWrite(channel.code, on)} /> : <span className="cpanel-state">{write ? "on" : "off"}</span>}
      </div>
      <div
        className="cpanel-row"
        title={
          prefix
            ? undefined
            : "With a prefix, a pull request from a branch named with it and a task's number shows on that task. Without one, a pull request shows on a task only when someone posts its link."
        }
      >
        <span className="cpanel-value">Branch prefix</span>
        {sets ? (
          <span className="cpanel-prefix">
            <InlineEdit value={prefix ?? ""} label="Branch prefix" verb={prefix ? "Change" : "Set"} onSave={(v) => app.actions.setBranchPrefix(channel.code, v)} />
            {prefix && (
              <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.setBranchPrefix(channel.code, null)}>
                Clear
              </button>
            )}
          </span>
        ) : (
          <span className="cpanel-state">{prefix ?? "none"}</span>
        )}
      </div>
      {prefix && <p className="cpanel-hint">A branch named {prefix}7-… shows its pull request on T7.</p>}
    </div>
  )
}

function ChannelIcon({ channel, own }: { channel: Channel; own: boolean }) {
  const { app } = useApp()
  const input = useRef<HTMLInputElement>(null)
  const tile = channel.icon ? <img src={channel.icon} alt="" /> : <span>{channel.title.slice(0, 1).toUpperCase()}</span>
  if (!own)
    return (
      <span className="cpanel-icon-tile" aria-hidden="true">
        {tile}
      </span>
    )
  return (
    <div className="cpanel-icon">
      <button
        type="button"
        className="cpanel-icon-tile is-button"
        aria-label={channel.icon ? "Change image…" : "Choose an image…"}
        title={channel.icon ? "Change image…" : "Choose an image…"}
        onClick={() => input.current?.click()}
      >
        {tile}
      </button>
      {channel.icon && (
        <button type="button" className="cpanel-icon-drop" aria-label="Remove the image" title="Remove the image" onClick={() => app.actions.setIcon(channel.code, null)}>
          <Icon name="close" size={12} />
        </button>
      )}
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
    </div>
  )
}

function MuteChannel({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const muted = isMuted(app.prefs.muted, channel.code)
  return (
    <section className="cpanel-mute" aria-label="Notifications">
      <div className="cpanel-row">
        <span className="cpanel-value">Mute on this computer</span>
        <Toggle label="Mute this channel" on={muted} onChange={(on) => app.actions.setMute(channel.code, null, on)} />
      </div>
      {muted && <p className="cpanel-hint">Mentions, direct messages and decisions for you still notify.</p>}
    </section>
  )
}

function Rooms({ channel, own }: { channel: Channel; own: boolean }) {
  const { app } = useApp()
  return (
    <ul className="cpanel-rooms">
      {channel.rooms.map((r) => (
        <li key={r.id} className={cx("cpanel-room", r.muted && "is-muted")}>
          <span className="cpanel-room-line">
            <span className="cpanel-room-hash" aria-hidden="true">
              {r.members ? <Icon name="people" size={12} /> : "#"}
            </span>
            {own ? (
              <InlineEdit value={r.name} label={`Name of #${r.name}`} verb="Rename" onSave={(name) => app.actions.renameRoom(channel.code, r.id, name)} />
            ) : (
              <span className="cpanel-value">{r.name}</span>
            )}
            <button
              type="button"
              className="icon-btn cpanel-bell"
              aria-label={r.muted ? `Unmute #${r.name}` : `Mute #${r.name}`}
              title={r.muted ? `Unmute #${r.name}` : `Mute #${r.name}`}
              aria-pressed={!!r.muted}
              onClick={() => app.actions.setMute(channel.code, r.id, !r.muted)}
            >
              {r.muted ? <GlyphIcon glyph={NotificationOff01Icon} /> : <GlyphIcon glyph={Notification01Icon} />}
            </button>
          </span>
          {r.members && <RoomPeople channel={channel} id={r.id} members={r.members} own={own} />}
        </li>
      ))}
    </ul>
  )
}

function RoomPeople({ channel, id, members, own }: { channel: Channel; id: string; members: string[]; own: boolean }) {
  const { app } = useApp()
  const [editing, setEditing] = useState<ReadonlySet<string> | null>(null)
  const canChange = useAppCan("changeRoom")
  const others = roomPeople(channel)
  const mine = seatRoot(channel, channel.you)
  const roots = [...new Set(members.map((m) => seatRoot(channel, m)))].filter((m) => m !== mine)
  const names = roots.map((m) => nickname(channel, m))
  if (!editing)
    return (
      <p className="cpanel-hint room-in cpanel-room-who">
        <Icon name="people" size={12} />
        <span>Members only: you{names.length ? `, ${names.join(", ")}` : ""}</span>
        {own && canChange && (
          <button type="button" className="btn is-quiet is-small cpanel-reveal" onClick={() => setEditing(new Set(roots))}>
            Change who's in
          </button>
        )}
      </p>
    )
  const flip = (name: string, on: boolean) =>
    setEditing((was) => {
      const next = new Set(was)
      if (on) next.add(name)
      else next.delete(name)
      return next
    })
  const out = roots.some((m) => !editing.has(m))
  return (
    <div className="room-pick">
      {others.map((p) => (
        <label key={p.name} className={cx("room-member", editing.has(p.name) && "is-on")}>
          <input type="checkbox" checked={editing.has(p.name)} onChange={(e) => flip(p.name, e.target.checked)} />
          <Avatar person={p} size="sm" />
          <span className="room-member-name">{shown(p)}</span>
        </label>
      ))}
      <p className="cpanel-hint">{out ? "Whoever you take out keeps what they could read, and nothing after: the room moves to a new key." : "Whoever you add reads the room's history."}</p>
      <div className="room-edit-foot">
        <button type="button" className="btn is-quiet is-small" onClick={() => setEditing(null)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn is-primary is-small"
          onClick={() => {
            void app.actions.setRoomMembers(channel.code, id, [...editing])
            setEditing(null)
          }}
        >
          Save
        </button>
      </div>
    </div>
  )
}

function Facts({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const [clearing, setClearing] = useState<string | null>(null)
  const facts = channel.facts ?? []
  return (
    <ul className="cpanel-facts">
      {facts.map((f) => (
        <li key={f.key} className="cpanel-fact">
          <button
            type="button"
            className="cpanel-fact-body"
            title={`Copy the value. Noted by ${nickname(channel, f.by)} ${ago(f.at) === "now" ? "just now" : `${ago(f.at)} ago`}.`}
            onClick={() => copyText(f.value, `Copied ${f.key}`)}
          >
            <span className="cpanel-fact-key">{f.key}</span>
            <span className="cpanel-fact-value">{f.value}</span>
          </button>
          {clearing === f.key ? (
            <span className="cpanel-fact-confirm">
              <button type="button" className="btn is-danger is-small" onClick={() => (app.actions.clearFact(channel.code, f.key), setClearing(null))}>
                Clear
              </button>
              <button type="button" className="btn is-quiet is-small" onClick={() => setClearing(null)}>
                Keep
              </button>
            </span>
          ) : (
            <span className="cpanel-reveal">
              <IconButton icon="close" label={`Clear ${f.key}`} onClick={() => setClearing(f.key)} />
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
