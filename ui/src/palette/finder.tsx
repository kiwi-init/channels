import "~/i18n/en/shell-later"
import { ComputerIcon, Link01Icon } from "@hugeicons/core-free-icons"
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react"

import { Avatar, cx, Dot, STATUS_WORDS } from "~/kit/bits"
import { useDebugOptions } from "~/kit/debug"
import { GlyphIcon, Icon } from "~/kit/icons"
import { docOf } from "~/chat/doc-of"
import type { App, Channel, Task, Where } from "~/model"
import { useApp, type Go, type Nav, type Panel } from "~/nav"
import { nickname, onePerPerson, roleWord, shown } from "~/names"
import { statusOf } from "~/shell/sidebar"
import { wordsPlain } from "~/words"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { runCommand } from "~/kit/commands"
import { keysHint } from "~/kit/keys"
import { matchAt, SEP } from "~/tasks/title-rank"
import { TONES } from "~/tasks/tones"
import { personGo } from "~/person-go"

type Group = "channels" | "rooms" | "people" | "tasks" | "actions"

const GROUPS: Group[] = ["channels", "rooms", "people", "tasks", "actions"]

const GROUP_KEYS: Record<Group, Key> = {
  channels: "palette.finder.group.channels",
  rooms: "palette.finder.group.rooms",
  people: "palette.finder.group.people",
  tasks: "palette.finder.group.tasks",
  actions: "palette.finder.group.actions",
}

const LIMIT = 8

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

function versionsHere(channel: Channel, nav: Nav): { thread: string; name: string; here: boolean } | null {
  const where: Where = nav.panel?.kind === "task" ? { kind: "task", task: nav.panel.task } : nav.where
  const thread = docOf(channel, where)
  if (!thread || !channel.docs?.[thread]) return null
  const name = where.kind === "task" ? `T${where.task}` : where.kind === "room" ? `#${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}` : t("palette.finder.this.conversation")
  return { thread, name, here: where.kind !== "task" && where.kind !== "room" }
}

interface Ranked {
  group: Group
  items: Item[]
}

export function Finder() {
  const { app, nav, go } = useApp()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()
  const debug = useDebugOptions()
  const groups = rank(collect(app, nav, go, debug), q)
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
          placeholder={t("palette.finder.placeholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKey}
          role="combobox"
          aria-label={t("palette.finder.jump.to")}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={flat.length ? optionId(current) : undefined}
        />
      </div>
      <div ref={listRef} id={listId} className="palette-list" role="listbox" aria-label={t("palette.finder.results")}>
        {groups.length === 0 && <p className="palette-none">{t("palette.finder.nothing.matches", { query: query.trim() })}</p>}
        {groups.map((g, gi) => (
          <div key={g.group} className="palette-group" role="group" aria-label={t(GROUP_KEYS[g.group])}>
            <div className="palette-heading" aria-hidden="true">
              {t(GROUP_KEYS[g.group])}
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

function collect(app: App, nav: Nav, go: (go: Go) => void, debug: boolean): Item[] {
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
      group: "channels",
      label: tile.title,
      keys: [tile.code],
      lead: <span className={cx("palette-tile", tile.state !== "member" && "is-waiting")}>{tile.icon ? <img src={tile.icon} alt="" /> : tile.title.slice(0, 1).toUpperCase()}</span>,
      meta:
        tile.state === "waiting" ? (
          t("palette.finder.channel.waiting")
        ) : tile.needsYou > 0 ? (
          <span className="tone-decide">{t("palette.finder.channel.need.you", { count: tile.needsYou })}</span>
        ) : here ? (
          t("palette.finder.channel.open")
        ) : tile.unread > 0 ? (
          t("palette.finder.channel.new.messages")
        ) : undefined,
      run: () => (here ? close() : go({ to: "channel", code: tile.code })),
    })
  }

  const channel = app.channel && !app.channel.waiting ? app.channel : null
  if (channel) {
    for (const room of channel.rooms) {
      items.push({
        id: `room:${room.id}`,
        group: "rooms",
        label: room.name,
        lead: <span className="palette-hash">#</span>,
        meta:
          room.mentions > 0 ? (
            <span className="tone-decide">{t("palette.finder.room.for.you", { count: room.mentions })}</span>
          ) : room.unread > 0 ? (
            t("palette.finder.room.new", { count: room.unread })
          ) : undefined,
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
        group: "people",
        label: shown(person),
        keys: [person.name, person.role ?? "", person.runs ?? "", person.kind === "agent" ? "agent" : "person"],
        lead: <Avatar person={person} size="sm" />,
        meta: [person.you ? t("palette.finder.person.you") : person.role && roleWord(person.role), status].filter(Boolean).join(" · "),
        run: () => {
          close()
          if (nav.page !== "channel") go({ to: "back" })
          go(personGo(channel, person.name))
        },
      })
    }

    for (const task of channel.tasks.filter((task) => !task.archived && task.status !== "done").sort(byRecent)) {
      items.push({
        id: `task:${task.id}`,
        group: "tasks",
        label: wordsPlain(task.title, channel.nicknames),
        tag: `T${task.id}`,
        keys: [String(task.id), task.owner ?? "", task.owner ? nickname(channel, task.owner) : ""],
        lead: <Dot status={task.status} />,
        meta: (
          <>
            {task.owner && `${nickname(channel, task.owner)} · `}
            <span className={TONES[task.status]}>{STATUS_WORDS[task.status]}</span>
          </>
        ),
        run: () => toPanel({ kind: "task", task: task.id }),
      })
    }
  }

  items.push(
    {
      id: "action:new-channel",
      group: "actions",
      label: t("palette.finder.new.channel"),
      keys: ["create", "start"],
      lead: <Icon name="plus" size={14} />,
      run: () => go({ to: "dialog", dialog: "new-channel" }),
    },
    {
      id: "action:join",
      group: "actions",
      label: t("palette.finder.join"),
      keys: ["invite", "link"],
      lead: <GlyphIcon glyph={Link01Icon} size={14} />,
      run: () => go({ to: "dialog", dialog: "join" }),
    },
    {
      id: "action:computers",
      group: "actions",
      label: t("palette.finder.computers"),
      keys: ["phones", "devices", "machines"],
      lead: <GlyphIcon glyph={ComputerIcon} size={14} />,
      run: () => go({ to: "settings", section: "computers" }),
    },
    {
      id: "action:settings",
      group: "actions",
      label: t("palette.finder.settings"),
      keys: ["preferences", "account"],
      lead: <Icon name="gear" size={14} />,
      run: () => go({ to: "settings" }),
    }
  )

  if (nav.page !== "channel" || nav.channel !== null)
    items.push({
      id: "action:home",
      group: "actions",
      label: t("palette.finder.home"),
      keys: ["start", "channels"],
      lead: <Icon name="home" size={14} />,
      run: () => go({ to: "home" }),
    })

  if (channel && nav.page === "channel")
    items.push(
      {
        id: "action:needs",
        group: "actions",
        label: t("palette.finder.needs.you"),
        keys: ["asks", "decide", "waiting", "approve"],
        lead: <Icon name="check" size={14} />,
        run: () => {
          close()
          go({ to: "tab", tab: "needs" })
        },
      },
      {
        id: "action:search",
        group: "actions",
        label: t("palette.finder.search"),
        keys: ["find", "messages"],
        lead: <Icon name="search" size={14} />,
        meta: <kbd className="palette-kbd">{keysHint("F")}</kbd>,
        run: () => {
          close()
          setTimeout(() => runCommand("find"))
        },
      }
    )

  const versions = channel && nav.page === "channel" ? versionsHere(channel, nav) : null
  if (versions)
    items.push({
      id: "action:doc-versions",
      group: "actions",
      label: versions.here ? t("palette.finder.versions.here") : t("palette.finder.versions.of", { name: versions.name }),
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
        group: "actions",
        label: t("palette.finder.trace.scroll"),
        keys: ["debug", "flicker", "scroll"],
        lead: <Icon name="search" size={14} />,
        run: () => {
          close()
          void import("~/kit/scroll-trace").then((m) => m.startScrollTrace())
        },
      },
      {
        id: "action:copy-scroll-trace",
        group: "actions",
        label: t("palette.finder.copy.scroll.trace"),
        keys: ["debug", "flicker", "scroll"],
        lead: <Icon name="copy" size={14} />,
        run: () => {
          close()
          void Promise.all([import("~/kit/scroll-trace"), import("~/kit/toasts")]).then(([m, toasts]) => toasts.copyText(m.scrollTrace(), t("palette.finder.scroll.trace.copied")))
        },
      },
      {
        id: "action:trace-typing",
        group: "actions",
        label: t("palette.finder.trace.typing"),
        keys: ["debug", "typing", "doc", "erased"],
        lead: <Icon name="search" size={14} />,
        run: () => {
          close()
          void Promise.all([import("~/kit/typing-trace"), import("~/kit/toasts")]).then(([m, toasts]) => {
            m.startTypingTrace()
            toasts.announce(t("palette.finder.tracing.typing"))
          })
        },
      },
      {
        id: "action:copy-typing-trace",
        group: "actions",
        label: t("palette.finder.copy.typing.trace"),
        keys: ["debug", "typing", "doc", "erased"],
        lead: <Icon name="copy" size={14} />,
        run: () => {
          close()
          void Promise.all([import("~/kit/typing-trace"), import("~/kit/toasts")]).then(([m, toasts]) => toasts.copyText(m.typingTrace(), t("palette.finder.typing.trace.copied")))
        },
      }
    )

  return items
}
