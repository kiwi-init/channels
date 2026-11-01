import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react"

import { Avatar, cx, Dot, STATUS_WORDS } from "~/kit/bits"
import { Icon } from "~/kit/icons"
import type { App, Task, TaskStatus, Theme } from "~/model"
import { useApp, type Go, type Nav, type Panel } from "~/nav"
import { nickname, onePerPerson, shown } from "~/names"
import { SIDEBAR_KEYS } from "@kiwi/app/sidebar-hidden.ts"
import { toggleSide } from "~/shell/side"
import { statusOf } from "~/shell/sidebar"

type Group = "Channels" | "Rooms" | "People" | "Tasks" | "Actions"

const GROUPS: Group[] = ["Channels", "Rooms", "People", "Tasks", "Actions"]

const LIMIT = 8

const SEP = /[\s#@/._:-]/

const FIRST_QUERY = new URLSearchParams(location.search).get("q") ?? ""

const TONE: Record<TaskStatus, string> = { todo: "", doing: "tone-doing", review: "tone-review", done: "tone-live", waiting: "tone-decide" }

const THEMES: { theme: Theme; label: string; icon: "moon" | "sun" | "computer" }[] = [
  { theme: "dark", label: "Theme: Dark", icon: "moon" },
  { theme: "light", label: "Theme: Light", icon: "sun" },
  { theme: "system", label: "Theme: System", icon: "computer" },
]

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
  const groups = rank(collect(app, nav, go), q)
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
          placeholder="Jump to a channel, room, person or task…"
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
      <footer className="palette-foot" aria-hidden="true">
        <span>
          <kbd className="palette-kbd">↑</kbd>
          <kbd className="palette-kbd">↓</kbd> move
        </span>
        <span>
          <kbd className="palette-kbd">↵</kbd> open
        </span>
        <span>
          <kbd className="palette-kbd">esc</kbd> close
        </span>
      </footer>
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

function collect(app: App, nav: Nav, go: (go: Go) => void): Item[] {
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
        run: () => toPanel({ kind: "person", name: person.name }),
      })
    }

    for (const task of channel.tasks.filter((t) => !t.archived && t.status !== "done").sort(byRecent)) {
      items.push({
        id: `task:${task.id}`,
        group: "Tasks",
        label: task.title,
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

  items.push(
    {
      id: "action:new-channel",
      group: "Actions",
      label: "New channel",
      keys: ["create", "start"],
      lead: <Icon name="plus" size={14} />,
      run: () => go({ to: "dialog", dialog: "new-channel" }),
    },
    {
      id: "action:join",
      group: "Actions",
      label: "Join with a code",
      keys: ["invite", "link"],
      lead: <Icon name="link" size={14} />,
      run: () => go({ to: "dialog", dialog: "join" }),
    },
    {
      id: "action:computers",
      group: "Actions",
      label: "Your computers",
      keys: ["phones", "devices", "machines"],
      lead: <Icon name="computer" size={14} />,
      run: () => go({ to: "settings", section: "computers" }),
    },
    {
      id: "action:settings",
      group: "Actions",
      label: "Settings",
      keys: ["preferences", "account"],
      lead: <Icon name="gear" size={14} />,
      run: () => go({ to: "settings" }),
    }
  )

  if (channel && nav.page === "channel")
    items.push({
      id: "action:sidebar",
      group: "Actions",
      label: "Toggle sidebar",
      keys: ["hide", "show", "rooms", "people"],
      lead: <Icon name="sidebar" size={14} />,
      meta: <kbd className="palette-kbd">{SIDEBAR_KEYS}</kbd>,
      run: () => {
        close()
        toggleSide()
      },
    })

  for (const t of THEMES) {
    const on = app.prefs.theme === t.theme
    items.push({
      id: `action:theme-${t.theme}`,
      group: "Actions",
      label: t.label,
      keys: ["appearance", "mode"],
      lead: <Icon name={t.icon} size={14} />,
      meta: on ? <Icon name="check" size={14} label="Current theme" /> : undefined,
      run: () => {
        if (!on) app.actions.setPrefs({ theme: t.theme })
        close()
      },
    })
  }

  return items
}
