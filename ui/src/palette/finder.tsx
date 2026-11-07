import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react"

import { Avatar, cx, Dot, STATUS_WORDS } from "~/kit/bits"
import { useDebugOptions } from "~/kit/debug"
import { Moon02Icon, PuzzleIcon, Sun03Icon } from "@hugeicons/core-free-icons"
import { GlyphIcon, Icon, type Glyph, type IconName } from "~/kit/icons"
import { docOf } from "~/chat/doc-of"
import type { App, Channel, Task, TaskStatus, Where } from "~/model"
import { useApp, type Go, type Nav, type Panel } from "~/nav"
import { nickname, onePerPerson, shown } from "~/names"
import { APP } from "~/commands/list"
import { runCommand, shownKeys, useCommandTable, type Table } from "~/commands/table"
import { askAgain, modsNow, runningMod, useModsVersion } from "~/mods/host"
import { statusOf } from "~/shell/sidebar"
import { wordsPlain } from "~/words"

type Group = "Channels" | "Rooms" | "People" | "Tasks" | "Mods" | "Actions"

const GROUPS: Group[] = ["Channels", "Rooms", "People", "Tasks", "Mods", "Actions"]

const LIMIT = 8

const SEP = /[\s#@/._:-]/

const FIRST_QUERY = new URLSearchParams(location.search).get("q") ?? ""

const TONE: Record<TaskStatus, string> = { todo: "", doing: "tone-doing", review: "tone-review", landing: "tone-review", done: "tone-live", waiting: "tone-decide" }

const LOOKS: Record<string, { icon: IconName | Glyph; words: string[]; late?: true }> = {
  "app.new-channel": { icon: "plus", words: ["create", "start"] },
  "app.join": { icon: "link", words: ["invite", "link"] },
  "app.new-mod": { icon: PuzzleIcon, words: ["make", "create", "extension", "plugin", "panel", "command"] },
  "app.computers": { icon: "computer", words: ["phones", "devices", "machines"] },
  "app.settings": { icon: "gear", words: ["preferences", "account"] },
  "app.calm": { icon: Moon02Icon, words: ["idle"] },
  "view.sidebar": { icon: "sidebar", words: ["hide", "show", "rooms", "people"] },
  "chat.search": { icon: "search", words: ["find", "messages"] },
  "nav.back": { icon: "back", words: ["history", "previous"] },
  "nav.forward": { icon: "chevron", words: ["history", "next"] },
  "nav.next-news": { icon: "tray", words: ["unread", "channel"] },
  "nav.previous-news": { icon: "tray", words: ["unread", "channel"] },
  "view.theme-dark": { icon: Moon02Icon, words: ["appearance", "mode"], late: true },
  "view.theme-light": { icon: Sun03Icon, words: ["appearance", "mode"], late: true },
  "view.theme-system": { icon: "computer", words: ["appearance", "mode"], late: true },
}

const ORDER = Object.keys(LOOKS)

const placeOf = (id: string): number => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length)

interface Item {
  id: string
  group: Group
  label: string
  tag?: string
  keys?: string[]
  lead: ReactNode
  meta?: ReactNode
  run: () => void
}

function versionsHere(channel: Channel, nav: Nav): { thread: string; name: string } | null {
  const where: Where = nav.panel?.kind === "task" ? { kind: "task", task: nav.panel.task } : nav.where
  const thread = docOf(channel, where)
  if (!thread || !channel.docs?.[thread]) return null
  const name = where.kind === "task" ? `T${where.task}` : where.kind === "room" ? `#${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}` : "This conversation"
  return { thread, name }
}

interface Ranked {
  group: Group
  items: Item[]
}

export function Finder() {
  const { app, nav, go } = useApp()
  const [query, setQuery] = useState(FIRST_QUERY)
  const [active, setActive] = useState(0)
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()
  const debug = useDebugOptions()
  const table = useCommandTable()
  useModsVersion()
  const groups = rank(collect(app, nav, go, debug, table), q)
  const flat = groups.flatMap((g) => g.items)
  const current = Math.max(0, Math.min(active, flat.length - 1))
  const optionId = (i: number) => `${listId}-${i}`

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
  }, [current, q])

  const move = (by: number) => {
    if (flat.length) setActive((current + by + flat.length) % flat.length)
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    const ctrl = e.ctrlKey && !e.metaKey && !e.altKey
    if (e.key === "ArrowDown" || (ctrl && e.key === "n")) {
      e.preventDefault()
      move(1)
    } else if (e.key === "ArrowUp" || (ctrl && e.key === "p")) {
      e.preventDefault()
      move(-1)
    } else if ((e.key === "Home" || e.key === "End") && flat.length) {
      e.preventDefault()
      setActive(e.key === "Home" ? 0 : flat.length - 1)
    } else if (e.key === "Enter") {
      e.preventDefault()
      flat[current]?.run()
    }
  }

  const starts = groups.map((_, g) => groups.slice(0, g).reduce((n, x) => n + x.items.length, 0))
  return (
    <div className="palette-box">
      <div className="palette-search">
        <Icon name="search" />
        <input
          className="palette-input"
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Jump to…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKey}
          role="combobox"
          aria-label="Jump to"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={flat.length ? optionId(current) : undefined}
        />
      </div>
      <div ref={listRef} id={listId} className="palette-list" role="listbox" aria-label="Results">
        {groups.length === 0 && <p className="palette-none">Nothing matches “{query.trim()}”.</p>}
        {groups.map((g, gi) => (
          <div key={g.group} className="palette-group" role="group" aria-label={g.group}>
            <div className="palette-heading" aria-hidden="true">
              {g.group}
            </div>
            {g.items.map((item, n) => {
              const i = (starts[gi] ?? 0) + n
              return (
                <div
                  key={item.id}
                  id={optionId(i)}
                  className={cx("palette-item", i === current && "is-on")}
                  role="option"
                  aria-selected={i === current}
                  onMouseMove={() => i !== current && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={item.run}
                >
                  <span className="palette-lead">{item.lead}</span>
                  <span className="palette-label">
                    {item.tag && (
                      <>
                        <span className="palette-tag">
                          <Marked text={item.tag} q={q} />
                        </span>{" "}
                      </>
                    )}
                    <Marked text={item.label} q={q} />
                  </span>
                  {item.meta && <span className="palette-meta">{item.meta}</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function Marked({ text, q }: { text: string; q: string }) {
  const at = q ? matchAt(text.toLowerCase(), q) : -1
  if (at < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="palette-mark">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}

function matchAt(text: string, q: string): number {
  let first = -1
  for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) {
    if (i === 0 || SEP.test(text.charAt(i - 1))) return i
    if (first < 0) first = i
  }
  return first
}

function score(item: Item, q: string): number {
  if (!q) return 0
  const text = item.label.toLowerCase()
  const keys = [item.tag ?? "", ...(item.keys ?? [])].map((k) => k.toLowerCase()).filter(Boolean)
  const at = matchAt(text, q)
  if (at === 0) return 0
  if (keys.some((k) => k.startsWith(q))) return 1
  if (at > 0 && SEP.test(text.charAt(at - 1))) return 2
  if (at > 0) return 3
  if (keys.some((k) => k.includes(q))) return 4
  return -1
}

function rank(items: Item[], q: string): Ranked[] {
  const scored = items.map((item, i) => ({ item, i, s: score(item, q) })).filter((x) => x.s >= 0)
  return GROUPS.map((group, order) => {
    const list = scored.filter((x) => x.item.group === group).sort((a, b) => a.s - b.s || a.i - b.i)
    return { group, order, best: list[0]?.s ?? Infinity, items: list.slice(0, LIMIT).map((x) => x.item) }
  })
    .filter((g) => g.items.length > 0)
    .sort((a, b) => a.best - b.best || a.order - b.order)
    .map(({ group, items }) => ({ group, items }))
}

const byRecent = (a: Task, b: Task): number => b.updatedAt - a.updatedAt

function commandItems(app: App, table: Table, close: () => void, late: boolean): Item[] {
  const bound = new Map(table.bound.map((b) => [b.id, b]))
  const shown = APP.filter((c) => bound.has(c.id) && !("palette" in c) && bound.get(c.id)?.palette !== false)
  return [...shown.map((c) => ({ id: c.id, title: c.title, from: "" })), ...table.mods]
    .filter((c) => !!LOOKS[c.id]?.late === late)
    .sort((a, b) => placeOf(a.id) - placeOf(b.id))
    .map((c) => {
      const look = LOOKS[c.id]
      const keys = shownKeys(table, c.id)
      const on = c.id === `view.theme-${app.prefs.theme}`
      return {
        id: `command:${c.id}`,
        group: "Actions",
        label: c.title,
        keys: [...(look?.words ?? []), ...(c.from ? [c.from] : [])],
        lead: typeof look?.icon === "object" ? <GlyphIcon glyph={look.icon} size={14} /> : <Icon name={look?.icon ?? "chevron"} size={14} />,
        meta: on ? <Icon name="check" size={14} label="Current theme" /> : keys ? <kbd className="palette-kbd">{keys}</kbd> : undefined,
        run: () => {
          close()
          setTimeout(() => runCommand(c.id))
        },
      }
    })
}

function collect(app: App, nav: Nav, go: (go: Go) => void, debug: boolean, table: Table): Item[] {
  const close = () => go({ to: "dialog", dialog: null })
  const toPanel = (panel: Panel) => {
    close()
    if (nav.page !== "channel") go({ to: "back" })
    go({ to: "panel", panel })
  }
  const items: Item[] = []

  for (const tile of app.channels) {
    const here = nav.page === "channel" && nav.channel === tile.code
    items.push({
      id: `channel:${tile.code}`,
      group: "Channels",
      label: tile.title,
      keys: [tile.code],
      lead: <span className={cx("palette-tile", tile.state !== "member" && "is-waiting")}>{tile.icon ? <img src={tile.icon} alt="" /> : tile.title.slice(0, 1).toUpperCase()}</span>,
      meta:
        tile.state === "waiting" ? (
          "waiting to be let in"
        ) : tile.needsYou > 0 ? (
          <span className="tone-decide">{tile.needsYou} need you</span>
        ) : here ? (
          "open"
        ) : tile.unread > 0 ? (
          "new messages"
        ) : undefined,
      run: () => (here ? close() : go({ to: "channel", code: tile.code })),
    })
  }

  const channel = app.channel && !app.channel.waiting ? app.channel : null
  if (channel) {
    for (const room of channel.rooms) {
      items.push({
        id: `room:${room.id}`,
        group: "Rooms",
        label: room.name,
        lead: <span className="palette-hash">#</span>,
        meta: room.mentions > 0 ? <span className="tone-decide">{room.mentions} for you</span> : room.unread > 0 ? `${room.unread} new` : undefined,
        run: () => {
          close()
          go({ to: "where", where: { kind: "room", room: room.id } })
        },
      })
    }

    for (const person of onePerPerson(channel.people)) {
      const status = statusOf(person, channel)
      items.push({
        id: `person:${person.name}`,
        group: "People",
        label: shown(person),
        keys: [person.name, person.role ?? "", person.runs ?? "", person.kind === "agent" ? "agent" : "person"],
        lead: <Avatar person={person} size="sm" />,
        meta: [person.you ? "you" : person.role, status].filter(Boolean).join(" · "),
        run: () => {
          close()
          if (nav.page !== "channel") go({ to: "back" })
          go({ to: "modal", modal: { kind: "person", name: person.name } })
        },
      })
    }

    for (const task of channel.tasks.filter((t) => !t.archived && t.status !== "done").sort(byRecent)) {
      items.push({
        id: `task:${task.id}`,
        group: "Tasks",
        label: wordsPlain(task.title, channel.nicknames),
        tag: `T${task.id}`,
        keys: [String(task.id), task.owner ?? "", task.owner ? nickname(channel, task.owner) : ""],
        lead: <Dot status={task.status} />,
        meta: (
          <>
            {task.owner && `${nickname(channel, task.owner)} · `}
            <span className={TONE[task.status]}>{STATUS_WORDS[task.status]}</span>
          </>
        ),
        run: () => toPanel({ kind: "task", task: task.id }),
      })
    }
  }

  items.push(...commandItems(app, table, close, false))

  const versions = channel && nav.page === "channel" ? versionsHere(channel, nav) : null
  if (versions)
    items.push({
      id: "action:doc-versions",
      group: "Actions",
      label: `Earlier versions of ${versions.name === "This conversation" ? "this doc" : `the ${versions.name} doc`}`,
      keys: ["restore", "history", "undo", "doc"],
      lead: <Icon name="spec" size={14} />,
      run: () => {
        close()
        go({ to: "modal", modal: { kind: "versions", thread: versions.thread, name: versions.name } })
      },
    })

  if (debug)
    items.push(
      {
        id: "action:trace-scroll",
        group: "Actions",
        label: "Trace scrolling for 20 seconds",
        keys: ["debug", "flicker", "scroll"],
        lead: <Icon name="search" size={14} />,
        run: () => {
          close()
          void import("~/kit/scroll-trace").then((m) => m.startScrollTrace())
        },
      },
      {
        id: "action:copy-scroll-trace",
        group: "Actions",
        label: "Copy scroll trace",
        keys: ["debug", "flicker", "scroll"],
        lead: <Icon name="copy" size={14} />,
        run: () => {
          close()
          void Promise.all([import("~/kit/scroll-trace"), import("~/kit/toasts")]).then(([m, t]) => t.copyText(m.scrollTrace(), "Scroll trace copied"))
        },
      },
      {
        id: "action:trace-typing",
        group: "Actions",
        label: "Trace typing for 60 seconds",
        keys: ["debug", "typing", "doc", "erased"],
        lead: <Icon name="search" size={14} />,
        run: () => {
          close()
          void Promise.all([import("~/kit/typing-trace"), import("~/kit/toasts")]).then(([m, t]) => {
            m.startTypingTrace()
            t.announce("Tracing typing for 60 seconds")
          })
        },
      },
      {
        id: "action:copy-typing-trace",
        group: "Actions",
        label: "Copy typing trace",
        keys: ["debug", "typing", "doc", "erased"],
        lead: <Icon name="copy" size={14} />,
        run: () => {
          close()
          void Promise.all([import("~/kit/typing-trace"), import("~/kit/toasts")]).then(([m, t]) => t.copyText(m.typingTrace(), "Typing trace copied"))
        },
      }
    )

  for (const mod of modsNow()) {
    const run = runningMod(mod.name)
    const open = () => toPanel({ kind: "mod", name: mod.name })
    if (mod.state !== "on" || run?.failed)
      items.push({
        id: `mod:${mod.name}`,
        group: "Mods",
        label: mod.state === "asks" ? `Set up ${mod.name}` : mod.name,
        keys: ["mod"],
        lead: <Icon name="spec" size={14} />,
        meta: mod.state === "asks" ? <span className="tone-decide">asks to run</span> : mod.state === "off" ? "off" : "stopped",
        run: mod.state === "asks" ? () => (close(), askAgain(mod.name)) : open,
      })
    else if (run?.title) items.push({ id: `mod:${mod.name}`, group: "Mods", label: run.title, keys: [mod.name, "mod"], lead: <Icon name="spec" size={14} />, meta: mod.name, run: open })
  }

  items.push(...commandItems(app, table, close, true))

  return items
}
