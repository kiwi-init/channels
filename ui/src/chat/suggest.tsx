import { useCallback, useMemo, useState, type RefObject } from "react"

import { mentionNames, type Picks } from "~/chat/linked"
import { peopleMatches, taskMatches } from "~/chat/matches"
import { t } from "~/i18n/i18n"
import { Avatar, cx, Dot, STATUS_WORDS } from "~/kit/bits"
import type { Channel, Person, Task } from "~/model"
import { nickname, onePerPerson, shown, Shown } from "~/names"

const MENTION = /(^|\s)@([\p{L}\p{N}_.-]*)$/u
const TASK_REF = /(^|\s)#([^#\n]{0,40})$/u

const picked = new Map<string, Picks>()
function picksFor(id: string): Picks {
  const have = picked.get(id)
  if (have) return have
  const made: Picks = new Map()
  picked.set(id, made)
  return made
}

type Pickable = { key: string; preventDefault(): void; stopPropagation(): void }

export type Suggest = {
  id: string
  pick: number
  quiet: boolean
  people: Person[]
  tasks: Task[]
  count: number
  moved: (at: number) => void
  insert: (before: string) => void
  complete: (name: string) => void
  completeTask: (id: number) => void
  keys: (e: Pickable, more?: { count: number; choose: (i: number) => void }) => boolean
  sent: (body: string) => string
  forget: () => void
}

export function useSuggest({
  channel,
  id,
  text,
  area,
  onText,
}: {
  channel: Channel
  id: string
  text: string
  area: RefObject<HTMLTextAreaElement | null>
  onText: (value: string, at: number) => void
}): Suggest {
  const [caret, setCaret] = useState(text.length)
  const [pick, setPick] = useState(0)
  const [closed, setClosed] = useState(false)
  const typed = text.slice(0, caret)
  const query = closed ? undefined : MENTION.exec(typed)?.[2]
  const taskQuery = closed || query !== undefined ? undefined : TASK_REF.exec(typed)?.[2]
  const people = query === undefined ? [] : peopleMatches(channel.people, query)
  const tasks = taskQuery === undefined ? [] : taskMatches(channel.tasks, taskQuery)
  const mentions = useMemo(() => mentionNames(onePerPerson(channel.people), channel.former), [channel.people, channel.former])

  const moved = useCallback((at: number) => {
    setCaret(at)
    setPick(0)
    setClosed(false)
  }, [])
  const insert = (before: string) => {
    onText(before + text.slice(caret), before.length)
    moved(before.length)
    requestAnimationFrame(() => {
      const el = area.current
      if (!el) return
      el.focus()
      el.setSelectionRange(before.length, before.length)
    })
  }
  const complete = (name: string) => insert(typed.replace(MENTION, (_all, pre: string) => `${pre}@${mentions.typed(name, picksFor(id))} `))
  const completeTask = (task: number) => insert(typed.replace(TASK_REF, (_all, pre: string) => `${pre}T${task} `))

  const keys: Suggest["keys"] = (e, more) => {
    const count = people.length || tasks.length || (more?.count ?? 0)
    if (!count) return false
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      setPick((pick + (e.key === "ArrowDown" ? 1 : count - 1)) % count)
      return true
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      const p = people[pick]
      const t = tasks[pick]
      if (p) complete(p.name)
      else if (t) completeTask(t.id)
      else more?.choose(pick)
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      setClosed(true)
      return true
    }
    return false
  }

  return {
    id,
    pick,
    quiet: closed || query !== undefined || taskQuery !== undefined,
    people,
    tasks,
    count: people.length || tasks.length,
    moved,
    insert,
    complete,
    completeTask,
    keys,
    sent: (body) => mentions.sent(body, picksFor(id)),
    forget: () => void picked.delete(id),
  }
}

export function listId(s: Suggest): string | undefined {
  return s.people.length ? `${s.id}-people` : s.tasks.length ? `${s.id}-tasks` : undefined
}

export function Suggestions({ channel, s }: { channel: Channel; s: Suggest }) {
  if (s.tasks.length)
    return (
      <ul className="mentions" role="listbox" aria-label={t("chat.suggest.tasks")} id={`${s.id}-tasks`}>
        {s.tasks.map((t, i) => (
          <li key={t.id} role="option" aria-selected={i === s.pick}>
            <button type="button" tabIndex={-1} className={cx("mention-row task-row", i === s.pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => s.completeTask(t.id)}>
              <Dot status={t.status} />
              <span className="task-row-id">T{t.id}</span>
              <span className="task-row-title">
                <Shown value={t.title} />
              </span>
              <span className="dim">{t.owner ? nickname(channel, t.owner) : STATUS_WORDS[t.status]}</span>
            </button>
          </li>
        ))}
      </ul>
    )
  if (!s.people.length) return null
  return (
    <ul className="mentions" role="listbox" aria-label={t("chat.suggest.people")} id={`${s.id}-people`}>
      {s.people.map((p, i) => (
        <li key={p.name} role="option" aria-selected={i === s.pick}>
          <button type="button" tabIndex={-1} className={cx("mention-row", i === s.pick && "is-on")} onMouseDown={(e) => e.preventDefault()} onClick={() => s.complete(p.name)}>
            <Avatar person={p} size="sm" pip />
            <span className="mention-name">{shown(p)}</span>
            <span className="dim">{p.role ?? p.runs ?? (p.kind === "human" ? t("chat.suggest.person") : t("chat.suggest.agent"))}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
