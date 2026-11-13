import "~/i18n/en/modals"
import { QUIET_MINUTES } from "@kiwi/core/protocol.ts"
import { NotificationOff01Icon } from "@hugeicons/core-free-icons"
import "~/styles/channel-settings.css"
import "~/styles/channel-sheet.css"

import { useEffect, useRef, useState, type ReactNode } from "react"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { autofocus, Avatar, cx } from "~/kit/bits"
import { Field, Toggle } from "~/kit/form"
import { Details, Failed, failedToast, failure, rawOf, type Failure } from "~/kit/failed"
import { Modal } from "~/kit/modal"
import { Track } from "~/kit/glide"
import { GlyphIcon, Icon } from "~/kit/icons"
import { choreLine } from "~/github/health"
import { ageOf, ago } from "~/kit/time"
import type { Channel, Room } from "~/model"
import { nickname, roomPeople, shown } from "~/names"
import { roomSelection } from "./room-selection.ts"
import { useApp, type ChannelTab, useGo } from "~/nav"
import { repoOffers } from "~/modals/repo-offers"
import { LandingPick, landingWord } from "~/modals/landing-pick"
import { Edit, GoalEditor, HoldNote, RepoAdd } from "~/modals/channel-fields"
import { Confirm } from "~/settings/controls"
import { acts, card, code, esc, field, fine, join, link, main, note, row, say, Sheet, toggle, type Acts } from "~/settings/sheet"
import { useAppCan } from "~/live/app-can"
import { isMuted } from "~/live/mute"
import { copyText } from "~/kit/toasts"

const TABS: readonly (readonly [ChannelTab, Key])[] = [
  ["general", "modals.channel.settings.tab.general"],
  ["rooms", "modals.channel.settings.tab.rooms"],
  ["tasks", "modals.channel.settings.tab.tasks"],
  ["github", "modals.channel.settings.tab.github"],
  ["notes", "modals.channel.settings.tab.notes"],
]

export function ChannelSettings({ channel, tab: first, end, onClose }: { channel: Channel; tab?: ChannelTab; end?: true | undefined; onClose: () => void }) {
  const { app, go, toast } = useApp()
  const own = channel.youOwn
  const owner = channel.people.find((p) => p.owner)
  const [ending, setEnding] = useState(!!end)
  const tabs = TABS.filter(([id]) => id !== "notes" || (channel.facts?.length ?? 0) > 0)
  const [picked, setTab] = useState<ChannelTab>(first ?? "general")
  const tab = tabs.some(([id]) => id === picked) ? picked : "general"
  const sub = own ? t("modals.channel.settings.you.own") : owner ? t("modals.channel.settings.owns.it", { name: shown(owner) }) : undefined

  return (
    <>
      <Modal
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
        ) : tab === "tasks" ? (
          <Tasks channel={channel} />
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

interface Page {
  a: Acts
  locks: Map<string, { on: boolean; label: string }>
}

const page = (): Page => ({ a: acts(), locks: new Map() })

const heading = (key: Key): string => `## ${esc(t(key))}`

const indent = (block: string): string[] => block.split("\n").map((line) => (line ? `  ${line}` : ""))

function flip(p: Page, can: boolean, on: boolean, label: string, hint: string, run: () => void, below: readonly string[] = []): string {
  if (can) return [toggle(on, p.a.act(label, run), hint), ...below.filter(Boolean).flatMap(indent)].join("\n")
  const name = `lock:${p.locks.size}`
  p.locks.set(name, { on, label })
  return row({ label, hint, nested: [field(name), ...below] })
}

function lockOf(p: Page, name: string): ReactNode | undefined {
  const lock = p.locks.get(name)
  return lock ? <Toggle on={lock.on} label={lock.label} disabled why={t("modals.channel.settings.owner.only")} /> : undefined
}

function ChannelSheet({ md, p, field: own, mark, calm }: { md: string; p: Page; field?: (name: string) => ReactNode | undefined; mark?: (name: string) => ReactNode | undefined; calm?: boolean }) {
  return (
    <div className={cx("csheet", calm && "is-calm")}>
      <Sheet md={md} seal={p.a.seal} field={(name) => lockOf(p, name) ?? own?.(name)} mark={(name) => (name === "cs:github" ? <Icon name="github" /> : mark?.(name))} />
    </div>
  )
}

function goalCard(goal: string | undefined): string {
  const paras = (goal ?? "")
    .split(/\n\s*\n/)
    .map(esc)
    .filter(Boolean)
  return paras.length ? card(paras) : fine(say("modals.channel.settings.no.goal"))
}

function General({ channel, onEnd }: { channel: Channel; onEnd: () => void }) {
  const { app } = useApp()
  const own = channel.youOwn
  const sets = own || !!channel.youTrusted
  const muted = isMuted(app.prefs.muted, channel.code)
  const hold = channel.hold
  const [saving, setSaving] = useState<"transcript" | "log" | null>(null)
  const [naming, setNaming] = useState(false)
  const save = (kind: "transcript" | "log") => {
    if (saving !== null) return
    setSaving(kind)
    void app.actions
      .exportHistory(channel.code, kind)
      .catch((err: unknown) => failedToast(t("modals.channel.settings.history.failed"), err))
      .finally(() => setSaving(null))
  }
  const p = page()
  const { a } = p
  const paused = !hold
    ? say("modals.channel.settings.pause.hint")
    : `**${hold.by === channel.you ? say("modals.channel.settings.paused.by.you", { when: ago(hold.at) }) : say("modals.channel.settings.paused.by", { who: nickname(channel, hold.by), when: ago(hold.at) })}**`
  const download = (kind: "transcript" | "log", label: Key, hint: Key) =>
    row({
      label: t(label),
      hint: say(hint),
      line: a.act(saving === kind ? t("modals.channel.settings.saving") : t("modals.channel.settings.download"), () => save(kind)),
    })
  const md = join([
    own ? heading("modals.channel.settings.channel") : "",
    own
      ? row({
          label: t("modals.channel.settings.name"),
          line: naming ? "" : `${esc(channel.title)} ${a.act(t("modals.channel.settings.rename"), () => setNaming(true))}`,
          nested: naming ? [field("name")] : [],
        })
      : "",
    heading("modals.channel.settings.goal"),
    fine(say("modals.channel.settings.goal.hint")),
    sets ? field("goal") : goalCard(channel.goal),
    heading("modals.channel.settings.agents"),
    [
      flip(p, own, !!hold, t("modals.channel.settings.pause"), paused, () => app.actions.setHold(channel.code, !hold), hold && own ? [field("hold-note")] : hold?.note ? [card([esc(hold.note)])] : []),
      flip(p, own, !!channel.specsOnly, t("modals.channel.settings.specs.only"), say(channel.specsOnly ? "modals.channel.settings.specs.only.on" : "modals.channel.settings.specs.only.off"), () =>
        app.actions.setSpecsOnly(channel.code, !channel.specsOnly)
      ),
    ].join("\n"),
    heading("modals.channel.settings.notifications"),
    toggle(
      muted,
      a.act(t("modals.channel.settings.mute.here"), () => app.actions.setMute(channel.code, null, !muted)),
      muted ? say("modals.channel.settings.mute.here.hint") : ""
    ),
    heading("modals.channel.settings.history"),
    [
      download("transcript", "modals.channel.settings.transcript", "modals.channel.settings.transcript.hint"),
      download("log", "modals.channel.settings.signed.log", "modals.channel.settings.signed.log.hint"),
    ].join("\n"),
    a.act(own ? t("modals.channel.settings.delete.channel.more") : t("modals.channel.settings.leave.channel.more"), onEnd),
  ])
  const fields = (name: string): ReactNode | undefined =>
    name === "name" ? (
      <Edit value={channel.title} label={t("modals.channel.settings.channel.name")} onSave={(title) => app.actions.renameChannel(channel.code, title)} onDone={() => setNaming(false)} />
    ) : name === "goal" ? (
      <GoalEditor channel={channel} />
    ) : name === "hold-note" && hold ? (
      <HoldNote key={hold.at} channel={channel} />
    ) : undefined
  return <ChannelSheet md={md} p={p} field={fields} />
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
      {channel.icon && (
        <button
          type="button"
          className="cset-tile-off"
          aria-label={t("modals.channel.settings.image.remove")}
          title={t("modals.channel.settings.image.remove")}
          onClick={() => void app.actions.setIcon(channel.code, null)}
        >
          <Icon name="close" size={10} />
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
  )
}

interface Picking {
  id: string
  edits: ReadonlyMap<string, boolean>
}

function Rooms({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const go = useGo()
  const canChange = useAppCan("changeRoom")
  const sets = channel.youOwn || !!channel.youTrusted
  const [renaming, setRenaming] = useState<string | null>(null)
  const [picking, setPicking] = useState<Picking | null>(null)
  const rooms = channel.rooms.filter((r) => r.name.trim())
  const people = roomPeople(channel)
  const [saving, setSaving] = useState(false)
  const p = page()
  const { a } = p

  const members = (room: Room, roots: readonly string[], edits: ReadonlyMap<string, boolean>): string => {
    const picked = roomSelection(channel, room.members ?? [], edits)
    const flipOne = (name: string) => {
      if (!saving) setPicking({ id: room.id, edits: new Map(edits).set(name, !picked.includes(name)) })
    }
    const out = roots.some((m) => !picked.includes(m))
    const save = async () => {
      if (saving) return
      setSaving(true)
      try {
        if (await app.actions.setRoomMembers(channel.code, room.id, picked)) setPicking(null)
      } finally {
        setSaving(false)
      }
    }
    return join([
      people.map((person, i) => `- [${picked.includes(person.name) ? "x" : " "}] ${code(`cs:face:${i}`)} ${a.act(shown(person), () => flipOne(person.name))}`).join("\n"),
      fine(say(out ? "modals.channel.settings.room.take.out" : "modals.channel.settings.room.add")),
      `${a.act(t("modals.channel.settings.cancel"), () => !saving && setPicking(null))} ${main(a.act(t("modals.channel.settings.save"), () => void save()))}`,
    ])
  }

  const roomRow = (room: Room, i: number): string => {
    const roots = roomSelection(channel, room.members ?? [])
    const who = room.members
      ? [t("modals.channel.settings.room.you"), ...roots.map((m) => nickname(channel, m))].join(t("modals.channel.settings.room.list.sep"))
      : t("modals.channel.settings.room.everyone")
    const picked = picking?.id === room.id ? picking.edits : null
    const naming = renaming === room.id
    const line = [
      sets ? a.act(t("modals.channel.settings.rename"), () => setRenaming(room.id)) : "",
      room.members && sets && canChange && !picked ? a.act(t("modals.channel.settings.room.change.members"), () => setPicking({ id: room.id, edits: new Map() })) : "",
      a.act(t(room.muted ? "modals.channel.settings.room.unmute" : "modals.channel.settings.room.mute", { room: room.name }), () => app.actions.setMute(channel.code, room.id, !room.muted)),
    ]
    const head = row({
      mark: `cs:room:${i}`,
      label: room.name,
      hint: `${room.muted ? `${code("cs:muted")} ` : ""}${esc(who)}`,
      line: naming ? "" : line.filter(Boolean).join(" "),
      nested: naming ? [field(`rename:${room.id}`)] : [],
    })
    return picked ? [head, ...indent(members(room, roots, picked))].join("\n") : head
  }

  const md = join([
    heading("modals.channel.settings.tab.rooms"),
    fine(say("modals.channel.settings.rooms.hint")),
    rooms.map(roomRow).join("\n"),
    sets ? a.act(t("modals.channel.settings.new.room"), () => go({ to: "dialog", dialog: "new-room" })) : "",
  ])

  const fields = (name: string): ReactNode | undefined => {
    const room = name.startsWith("rename:") ? rooms.find((r) => r.id === name.slice("rename:".length)) : undefined
    return room ? (
      <Edit
        value={room.name}
        label={t("modals.channel.settings.room.name", { room: room.name })}
        onSave={(next) => app.actions.renameRoom(channel.code, room.id, next)}
        onDone={() => setRenaming(null)}
      />
    ) : undefined
  }
  const mark = (name: string): ReactNode | undefined => {
    if (name === "cs:muted") return <GlyphIcon glyph={NotificationOff01Icon} size={14} />
    if (name.startsWith("cs:face:")) {
      const person = people[Number(name.slice("cs:face:".length))]
      return person ? <Avatar person={person} size="sm" /> : undefined
    }
    if (!name.startsWith("cs:room:")) return undefined
    const room = rooms[Number(name.slice("cs:room:".length))]
    if (!room) return undefined
    return room.members ? <Icon name="people" size={14} /> : <span className="csheet-hash">#</span>
  }
  return <ChannelSheet md={md} p={p} field={fields} mark={mark} calm />
}

function GitHub({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const own = channel.youOwn
  const sets = own || !!channel.youTrusted
  const write = !!channel.githubWrite
  const prefix = channel.branchPrefix
  const [mine, setMine] = useState<string[]>([])
  const [offers, setOffers] = useState<Failure | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [prefixing, setPrefixing] = useState(false)
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
  const p = page()
  const { a } = p
  const health = channel.github
  const missing = (health?.status?.repos ?? []).filter((r) => r.installed === false)
  const errors = health?.errors ?? []
  const prefixLine = !sets
    ? prefix
      ? code(prefix)
      : esc(t("modals.channel.settings.none"))
    : [
        prefix ? code(prefix) : "",
        prefix ? a.act(t("modals.channel.settings.clear"), () => app.actions.setBranchPrefix(channel.code, null)) : "",
        a.act(prefix ? t("modals.channel.settings.change") : t("modals.channel.settings.set"), () => setPrefixing(true)),
      ]
        .filter(Boolean)
        .join(" ")
  const md = join([
    heading("modals.channel.settings.repos"),
    fine(say("modals.channel.settings.repos.hint")),
    channel.repos
      .map((r) =>
        row({
          mark: "cs:github",
          label: r,
          hint: link(`github.com/${r}`, `https://github.com/${r}`),
          line: sets ? a.act(t("modals.channel.settings.repo.remove.yes"), () => setRemoving(r), { label: t("modals.channel.settings.repo.remove", { repo: r }) }) : "",
        })
      )
      .join("\n"),
    !sets && !channel.repos.length ? fine(say("modals.channel.settings.no.repos")) : "",
    sets ? field("repo-add") : "",
    sets && offers ? field("repos-failed") : "",
    ...missing.map((r) =>
      note(
        [say("modals.channel.settings.app.missing", { account: r.repo.split("/")[0] ?? "", repo: r.repo, install: "" }), r.install ? link(t("modals.channel.settings.app.install"), r.install) : ""]
          .filter(Boolean)
          .join(" ")
      )
    ),
    ...errors.map((e, i) => join([note(esc(choreLine(e))), field(`raw:${i}`)])),
    heading("modals.channel.settings.access"),
    flip(p, own, write, t("modals.channel.settings.github.write"), say(write ? "modals.channel.settings.github.write.on" : "modals.channel.settings.github.write.off"), () =>
      app.actions.setGithubWrite(channel.code, !write)
    ),
    heading("modals.channel.settings.prs"),
    row({
      label: t("modals.channel.settings.branch.prefix"),
      hint: prefix ? say("modals.channel.settings.branch.prefix.set", { prefix }) : say("modals.channel.settings.branch.prefix.none"),
      line: prefixing ? "" : prefixLine,
      nested: prefixing ? [field("prefix")] : [],
    }),
  ])
  const fields = (name: string): ReactNode | undefined => {
    if (name === "repo-add") return <RepoAdd channel={channel} offer={repoOffers(mine, channel.repos)} />
    if (name === "repos-failed") return offers ? <Failed failure={offers} /> : undefined
    if (name === "prefix")
      return <Edit value={prefix ?? ""} label={t("modals.channel.settings.branch.prefix")} onSave={(v) => app.actions.setBranchPrefix(channel.code, v)} onDone={() => setPrefixing(false)} />
    const error = name.startsWith("raw:") ? errors[Number(name.slice("raw:".length))] : undefined
    return error ? <Details raw={error.message} /> : undefined
  }
  return (
    <>
      <ChannelSheet md={md} p={p} field={fields} />
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
    </>
  )
}

function repoFailure(err: unknown): Failure | null {
  if (/link GitHub/i.test(rawOf(err))) return null
  const expired = /expired/i.test(rawOf(err))
  return failure(t("modals.channel.settings.repos.failed"), err, { other: t(expired ? "modals.channel.settings.repos.expired" : "modals.channel.settings.repos.type") })
}

function Tasks({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const own = channel.youOwn
  const sets = own || !!channel.youTrusted
  const quiet = String(channel.quietMinutes ?? QUIET_MINUTES)
  const landing = channel.landing
  const [editing, setEditing] = useState(false)
  const p = page()
  const { a } = p
  const md = [
    row({
      label: t("modals.channel.settings.quiet"),
      hint: say("modals.channel.settings.quiet.hint", { minutes: quiet }),
      line: editing ? "" : [code(quiet), sets ? a.act(t("modals.channel.settings.change"), () => setEditing(true)) : ""].filter(Boolean).join(" "),
      nested: editing ? [field("quiet")] : [],
    }),
    flip(
      p,
      own,
      !!channel.reviewReset,
      t("modals.channel.settings.review.reset"),
      say(channel.reviewReset ? "modals.channel.settings.review.reset.on" : "modals.channel.settings.review.reset.off"),
      () => app.actions.setReviewReset(channel.code, !channel.reviewReset)
    ),
    row({
      label: t("modals.channel.settings.landing"),
      hint: say(landing ? "modals.channel.settings.landing.set" : "modals.channel.settings.landing.none"),
      line: sets ? "" : esc(landingWord(landing)),
      nested: sets ? [field("landing")] : [],
    }),
  ].join("\n")
  const fields = (name: string): ReactNode | undefined =>
    name === "quiet" ? (
      <Edit value={quiet} label={t("modals.channel.settings.quiet")} onSave={(v) => app.actions.setQuiet(channel.code, v)} onDone={() => setEditing(false)} />
    ) : name === "landing" ? (
      <LandingPick value={landing} onPick={(then) => app.actions.setLanding(channel.code, then)} />
    ) : undefined
  return <ChannelSheet md={md} p={p} field={fields} />
}

function Facts({ channel }: { channel: Channel }) {
  const { app } = useApp()
  const [clearing, setClearing] = useState<string | null>(null)
  const p = page()
  const { a } = p
  const md = join([
    heading("modals.channel.settings.tab.notes"),
    fine(say("modals.channel.settings.notes.hint")),
    (channel.facts ?? [])
      .map((f) =>
        row({
          label: f.key,
          hint:
            ageOf(f.at) === "now"
              ? say("modals.channel.settings.note.copy.now", { who: nickname(channel, f.by) })
              : say("modals.channel.settings.note.copy.ago", { who: nickname(channel, f.by), time: ago(f.at) }),
          line:
            clearing === f.key
              ? `${a.act(t("modals.channel.settings.note.keep"), () => setClearing(null))} ${main(
                  a.act(t("modals.channel.settings.clear"), () => {
                    app.actions.clearFact(channel.code, f.key)
                    setClearing(null)
                  })
                )}`
              : `${a.chip(f.value, () => void copyText(f.value, t("modals.channel.settings.note.copied", { key: f.key })))} ${a.act(t("modals.channel.settings.clear"), () => setClearing(f.key), { label: t("modals.channel.settings.note.clear", { key: f.key }) })}`,
        })
      )
      .join("\n"),
  ])
  return <ChannelSheet md={md} p={p} calm />
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
      ready={typed.trim().toLowerCase() === channel.title.trim().toLowerCase()}
      onClose={close}
      onConfirm={onDone}
    >
      <Field label={t("modals.channel.settings.delete.type", { title: channel.title })}>
        <input ref={autofocus} className="input is-mono" placeholder={channel.title} value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Field>
    </Confirm>
  )
}
