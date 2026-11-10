import { useCallback, useMemo, useState, type RefObject } from "react"

import { mentionNames, type Picks } from "~/chat/linked"
import { peopleMatches, refDone, specMatches, taskMatches } from "~/chat/matches"
import { t } from "~/i18n/i18n"
import { Avatar, cx, Dot, STATUS_WORDS } from "~/kit/bits"
import type { Channel, Person, Spec, Task } from "~/model"
import { nickname, onePerPerson, roleWord, shown, Shown } from "~/names"

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

type Pickable = { key: string; ctrlKey?: boolean; metaKey?: boolean; preventDefault(): void; stopPropagation(): void }

export type Suggest = {
  id: string
  pick: number
  quiet: boolean
  people: Person[]
  tasks: Task[]
  specs: Spec[]
  count: number
  moved: (at: number) => void
  insert: (before: string) => void
  complete: (name: string) => void
  completeTask: (id: number) => void
  completeSpec: (ask: number) => void
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
  withFormer = false,
}: {
  channel: Channel
  id: string
  text: string
  area: RefObject<HTMLTextAreaElement | null>
  onText: (value: string, at: number) => void
  withFormer?: boolean
}): Suggest {
  const [caret, setCaret] = useState(text.length)
  const [pick, setPick] = useState(0)
  const [closedOn, setClosedOn] = useState<string | null>(null)
  const [seen, setSeen] = useState(text)
  if (seen !== text) {
    setSeen(text)
    setClosedOn(null)
  }
  const closed = closedOn !== null && closedOn === `${caret}:${text}`
  const typed = text.slice(0, caret)
  const query = closed ? undefined : MENTION.exec(typed)?.[2]
  const asked = closed || query !== undefined ? undefined : TASK_REF.exec(typed)?.[2]
  const taskQuery = asked !== undefined && refDone(asked) ? undefined : asked
  const people = query === undefined ? [] : peopleMatches(withFormer ? [...channel.people, ...(channel.former ?? [])] : channel.people, query)
  const tasks = taskQuery === undefined ? [] : taskMatches(channel.tasks, taskQuery)
  const specs = taskQuery === undefined ? [] : specMatches(channel.specs ?? [], taskQuery)
  const mentions = useMemo(() => mentionNames(onePerPerson(channel.people), channel.former), [channel.people, channel.former])

  const moved = useCallback((at: number) => {
    setCaret(at)
    setPick(0)
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
  const completeSpec = (ask: number) => insert(typed.replace(TASK_REF, (_all, pre: string) => `${pre}#${ask} `))

  const keys: Suggest["keys"] = (e, more) => {
    const count = people.length || tasks.length + specs.length || (more?.count ?? 0)
    if (!count) return false
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      setPick((pick + (e.key === "ArrowDown" ? 1 : count - 1)) % count)
      return true
    }
    if ((e.key === "Enter" && !e.ctrlKey && !e.metaKey) || e.key === "Tab") {
      e.preventDefault()
      const p = people[pick]
      const t = tasks[pick]
      const sp = specs[pick - tasks.length]
      if (p) complete(p.name)
      else if (t) completeTask(t.id)
      else if (sp) completeSpec(sp.ask)
      else more?.choose(pick)
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      setClosedOn(`${caret}:${text}`)
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
    specs,
    count: people.length || tasks.length + specs.length,
    moved,
    insert,
    complete,
    completeTask,
    completeSpec,
    keys,
    sent: (body) => mentions.sent(body, picksFor(id)),
    forget: () => void picked.delete(id),
  }
}

export function listId(s: Suggest): string | undefined {
  return s.people.length ? `${s.id}-people` : s.tasks.length + s.specs.length ? `${s.id}-tasks` : undefined
}

export function Suggestions({ channel, s }: { channel: Channel; s: Suggest }) {
  if (s.tasks.length + s.specs.length)
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
        {s.specs.map((sp, i) => (
          <li key={`spec-${sp.ask}`} role="option" aria-selected={s.tasks.length + i === s.pick}>
            <button
              type="button"
              tabIndex={-1}
              className={cx("mention-row task-row", s.tasks.length + i === s.pick && "is-on")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => s.completeSpec(sp.ask)}
            >
              <span className="task-row-id">#{sp.ask}</span>
              <span className="task-row-title">
                <Shown value={sp.title} />
              </span>
              <span className="dim">{t("chat.suggest.spec")}</span>
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
            <span className="dim">{(p.role && roleWord(p.role)) ?? p.runs ?? (p.kind === "human" ? t("chat.suggest.person") : t("chat.suggest.agent"))}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
