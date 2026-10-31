import "~/styles/channel-panel.css"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"

import { Field, Heading, IconButton } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import { ago } from "~/kit/time"
import type { Channel } from "~/model"
import { nickname, shown } from "~/names"
import { useApp } from "~/nav"
import { PanelHead } from "~/panels/frame"
import { repoOffers } from "~/panels/repo-offers"
import { Toggle } from "~/kit/bits"
import { Confirm, InlineEdit } from "~/settings/controls"

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
      <PanelHead title={channel.title} />
      <div className="panel-body cpanel">
        <Part title="Name">
          {own ? (
            <InlineEdit value={channel.title} label="Channel name" verb="Rename" onSave={(title) => actions.renameChannel(channel.code, title)} />
          ) : (
            <p className="cpanel-value">{channel.title}</p>
          )}
          {!own && owner && <p className="cpanel-hint">{shown(owner)} owns this channel.</p>}
        </Part>

        <Part title="Icon">
          <ChannelIcon channel={channel} own={own} />
        </Part>

        <Part title="Rooms">
          <Rooms channel={channel} own={sets} />
        </Part>

        <Part title="Goal">{sets ? <GoalEditor channel={channel} /> : channel.goal ? <p className="cpanel-goal">{channel.goal}</p> : <p className="cpanel-none">No goal yet.</p>}</Part>

        <Part title="Repos">
          <Repos channel={channel} />
        </Part>

        {(sets ? channel.repos.length > 0 : channel.githubWrite || channel.branchPrefix) && (
          <Part title="GitHub">
            <GitHub channel={channel} own={own} sets={sets} />
          </Part>
        )}

        <Part title="Notes">
          <Facts channel={channel} />
        </Part>

        <Part title="Agents">
          <Hold channel={channel} />
        </Part>

        <Part title="History">
          <div className="cpanel-downloads">
            <button type="button" className="btn is-quiet cpanel-download" disabled={saving !== null} onClick={() => save("transcript")}>
              <Icon name="download" size={14} />
              {saving === "transcript" ? "Saving the transcript…" : "Download the transcript (.md)"}
            </button>
            <button type="button" className="btn is-quiet cpanel-download" disabled={saving !== null} onClick={() => save("log")}>
              <Icon name="download" size={14} />
              {saving === "log" ? "Saving the signed log…" : "Download the signed log (.jsonl)"}
            </button>
          </div>
        </Part>

        <div className="panel-section cpanel-end">
          <button type="button" className="btn is-danger" onClick={() => setEnding(true)}>
            {own ? "Close this channel" : "Leave this channel"}
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
          toast(own ? `Closed ${channel.title}` : `Left ${channel.title}`)
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
        placeholder="What this channel is for and what done looks like."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            e.currentTarget.form?.requestSubmit()
          }
        }}
      />
      <div className="cpanel-row">
        <p className="cpanel-hint">Every agent reads this first.</p>
        <button type="submit" className="btn is-small" disabled={!changed}>
          Save
        </button>
      </div>
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
        <p className="cpanel-none">{own ? "No repos yet. Agents work in the repos you add here." : "No repos yet."}</p>
      )}
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
    ) : (
      <p className="cpanel-value">Not paused</p>
    )

  return (
    <div className="cpanel-hold">
      <div className="cpanel-row">
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
      {hold ? (
        <>
          <p className="cpanel-held-line">
            Paused by {by} · {ago(hold.at)}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (note.trim() !== (hold.note ?? "")) app.actions.setHold(channel.code, true, note.trim() || undefined)
              e.currentTarget.querySelector("input")?.blur()
            }}
          >
            <Field label="Note for the agents" hint="Press Enter to save.">
              <input className="input is-mono" placeholder="Why they should wait" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </form>
        </>
      ) : (
        <p className="cpanel-hint">Agents keep reading but don't act until you resume.</p>
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
      title={`Close ${channel.title}?`}
      sub="Everyone is removed and agents stop for good. Download the history first if you want to keep it."
      action="Close the channel"
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

function GitHub({ channel, own, sets }: { channel: Channel; own: boolean; sets: boolean }) {
  const { app } = useApp()
  const write = !!channel.githubWrite
  const prefix = channel.branchPrefix
  return (
    <div className="cpanel-github">
      <div className="cpanel-row">
        <span className="cpanel-value">Write to GitHub</span>
        {own ? <Toggle on={write} label="Write to GitHub" onChange={(on) => app.actions.setGithubWrite(channel.code, on)} /> : <span className="cpanel-value">{write ? "On" : "Off"}</span>}
      </div>
      <p className="cpanel-hint">{write ? "Kiwi links new PRs and issues to their tasks, and a task closing closes its issue." : "Kiwi doesn't comment on or close anything in your repos."}</p>
      <div className="cpanel-row">
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
          <span className="cpanel-value is-mono">{prefix ?? "None"}</span>
        )}
      </div>
      <p className="cpanel-hint">
        {prefix
          ? `A pull request from a branch named ${prefix}7-… shows on T7.`
          : "With a prefix, a pull request from a branch named with it and a task's number shows on that task. Without one, a pull request shows on a task only when someone posts its link."}
      </p>
    </div>
  )
}

function ChannelIcon({ channel, own }: { channel: Channel; own: boolean }) {
  const { app } = useApp()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="cpanel-icon">
      <span className="cpanel-icon-tile" aria-hidden="true">
        {channel.icon ? <img src={channel.icon} alt="" /> : <span>{channel.title.slice(0, 1).toUpperCase()}</span>}
      </span>
      {own && (
        <>
          <button type="button" className="btn is-small" onClick={() => input.current?.click()}>
            {channel.icon ? "Change image…" : "Choose an image…"}
          </button>
          {channel.icon && (
            <button type="button" className="btn is-quiet is-small" onClick={() => app.actions.setIcon(channel.code, null)}>
              Remove
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
        </>
      )}
      {!own && !channel.icon && <p className="cpanel-none">No image: the channel shows its first letter.</p>}
    </div>
  )
}

function Rooms({ channel, own }: { channel: Channel; own: boolean }) {
  const { app } = useApp()
  return (
    <ul className="cpanel-rooms">
      {channel.rooms.map((r) => (
        <li key={r.id}>
          {own ? (
            <InlineEdit value={r.name} label={`Name of #${r.name}`} verb="Rename" onSave={(name) => app.actions.renameRoom(channel.code, r.id, name)} />
          ) : (
            <span className="cpanel-value">#{r.name}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function Facts({ channel }: { channel: Channel }) {
  const { app, toast } = useApp()
  const [clearing, setClearing] = useState<string | null>(null)
  const facts = channel.facts ?? []
  if (!facts.length) return <p className="cpanel-none">What agents note for everyone shows here. None yet.</p>
  return (
    <ul className="cpanel-facts">
      {facts.map((f) => (
        <li key={f.key} className="cpanel-fact">
          <button
            type="button"
            className="cpanel-fact-body"
            title="Copy the value"
            onClick={() =>
              void navigator.clipboard.writeText(f.value).then(
                () => toast(`Copied ${f.key}`),
                () => toast(`Couldn't copy ${f.key}`)
              )
            }
          >
            <span className="cpanel-fact-line">
              <span className="cpanel-fact-key">{f.key}</span>
              <span className="cpanel-fact-value">{f.value}</span>
            </span>
            <span className="cpanel-hint">
              {nickname(channel, f.by)} · {ago(f.at) === "now" ? "just now" : `${ago(f.at)} ago`}
            </span>
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
            <IconButton icon="close" label={`Clear ${f.key}`} onClick={() => setClearing(f.key)} />
          )}
        </li>
      ))}
    </ul>
  )
}
