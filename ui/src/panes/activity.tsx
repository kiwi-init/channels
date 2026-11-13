import "~/i18n/en/shell-later"
import "~/i18n/en/chat-later"
import "~/i18n/en/specs"
import "~/styles/activity.css"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react"

import { useActivity } from "~/chat/activity"
import { linesOf, type EventLine, type GithubPart, type TaskRun } from "~/chat/fold-events"
import { t } from "~/i18n/i18n"
import { clock, day, sameDay } from "~/kit/time"
import type { Channel, Message, Task } from "~/model"
import { join, link, maker, PageFrame, PageText, section, type Maker } from "~/panes/page"
import { wordsPlain } from "~/words"

const PAGE = 60
const NAMED = 3
const GITHUB = /github\.com\/([^/]+\/[^/]+)\/(pull|issues)\/(\d+)/
const NONE: readonly Message[][] = []

type Item = { kind: "day"; at: number } | { kind: "line"; line: EventLine }

interface Ui {
  limit: number
  open: ReadonlySet<string>
}

interface Ctx {
  channel: Channel
  tasks: ReadonlyMap<number, Task>
  m: Maker
  ui: Ui
  target: number | null
  setUi: Dispatch<SetStateAction<Ui>>
}

interface Rows {
  rows: string[]
  at: number
}

const FRESH: Ui = { limit: PAGE, open: new Set() }

const seqsOf = (line: EventLine): number[] => (line.kind === "one" ? [line.m.seq] : line.list.map((e) => e.seq))
const lastOf = (list: readonly Message[]): Message => list[list.length - 1]!
const meta = (...parts: string[]): string =>
  parts
    .filter(Boolean)
    .map((p) => ` · ${p}`)
    .join("")

function flip(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set)
  if (!next.delete(key)) next.add(key)
  return next
}

function githubUrl(e: Message): string | null {
  const note = e.github?.find((g) => g.number && (g.event === "pull_request" || g.event === "issues"))
  return note ? `kiwi-${note.event === "issues" ? "issue" : "pr"}:${note.repo}/${note.number}` : null
}

function eventRow(x: Ctx, e: Message, more = ""): string {
  const url = e.task !== undefined && x.tasks.has(e.task) ? `kiwi-task:${e.task}` : (githubUrl(e) ?? `kiwi-msg:${e.seq}`)
  return `- ${link(wordsPlain(e.text, x.channel.nicknames), url)}${meta(clock(e.at), more)}`
}

function runRow(x: Ctx, run: TaskRun): string {
  const last = lastOf(run.list)
  const url = x.tasks.has(run.id) ? `kiwi-task:${run.id}` : `kiwi-msg:${last.seq}`
  const count = run.list.length > 1 ? t("chat.updates.panel.updates", { count: run.list.length }) : ""
  return `- ${link(wordsPlain(last.text, x.channel.nicknames), url)}${meta(count, clock(last.at))}`
}

function partRow(x: Ctx, part: GithubPart, at: number, seq: number): string {
  const hit = part.url ? GITHUB.exec(part.url) : null
  const key = hit ? `${hit[1]}/${hit[3]}`.toLowerCase() : ""
  const pr = hit?.[2] === "pull"
  const named = hit ? (pr ? x.channel.prs : x.channel.issues)?.find((g) => `${g.repo}/${g.number}`.toLowerCase() === key) : undefined
  const url = hit ? `kiwi-${pr ? "pr" : "issue"}:${hit[1]}/${hit[3]}` : `kiwi-msg:${seq}`
  return `- ${link(named ? `${part.ref} ${named.title}` : `${part.ref} ${part.text}`, url)}${meta(named ? part.text : "", clock(at))}`
}

function lineRows(x: Ctx, line: EventLine): Rows {
  const seqs = seqsOf(line)
  const key = `${line.kind}${seqs[0]}`
  const hit = x.target !== null && seqs.includes(x.target)
  const open = x.ui.open.has(key) || (hit && line.kind !== "one")
  const toggle = (label: string): string => x.m.act(open ? t("chat.updates.panel.fewer") : label, () => x.setUi((u) => ({ ...u, open: flip(u.open, key) })))
  if (line.kind === "one") return { rows: [eventRow(x, line.m)], at: hit ? 0 : -1 }
  if (line.kind === "events") {
    const list = [...line.list].reverse()
    const more = toggle(t("chat.updates.panel.more", { count: list.length - 1 }))
    const rows = (open ? list : list.slice(0, 1)).map((e, i) => eventRow(x, e, i === 0 ? more : ""))
    return {
      rows,
      at: hit
        ? Math.max(
            0,
            list.findIndex((e) => e.seq === x.target)
          )
        : -1,
    }
  }
  if (line.kind === "tasks") {
    const runs = [...line.tasks].sort((a, b) => lastOf(b.list).at - lastOf(a.list).at)
    const shown = open ? runs : runs.slice(0, NAMED)
    const rows = shown.map((run) => runRow(x, run))
    if (runs.length > NAMED) rows[rows.length - 1] += ` · ${toggle(t("chat.updates.panel.more", { count: runs.length - NAMED }))}`
    return {
      rows,
      at: hit
        ? Math.max(
            0,
            shown.findIndex((run) => run.list.some((e) => e.seq === x.target))
          )
        : -1,
    }
  }
  const last = lastOf(line.list)
  const refs = line.parts.filter((p) => p.ref).map((p) => partRow(x, p, last.at, last.seq))
  const rest = line.parts.filter((p) => !p.ref).map((p) => p.text)
  const rows = [...refs, ...(rest.length ? [`- ${link(`GitHub · ${rest.join(", ")}`, `kiwi-msg:${last.seq}`)}${meta(clock(last.at))}`] : [])]
  return { rows: rows.length ? rows : [eventRow(x, last)], at: hit ? 0 : -1 }
}

function activityText(x: Ctx, runs: readonly Message[][], titled: boolean): { md: string; at: number } {
  const items: Item[] = []
  let last: number | null = null
  for (const run of [...runs].reverse()) {
    const at = run[0]!.at
    if (last === null || !sameDay(last, at)) items.push({ kind: "day", at })
    last = at
    for (const line of linesOf(run, x.tasks).reverse()) items.push({ kind: "line", line })
  }
  const reach = x.target === null ? -1 : items.findIndex((i) => i.kind === "line" && seqsOf(i.line).includes(x.target!))
  const shownTo = Math.max(x.ui.limit, reach + 1)
  const days: { at: number; rows: string[] }[] = []
  let count = 0
  let at = -1
  for (const item of items.slice(0, shownTo)) {
    if (item.kind === "day") {
      days.push({ at: item.at, rows: [] })
      continue
    }
    const got = lineRows(x, item.line)
    if (got.at >= 0 && at < 0) at = count + got.at
    count += got.rows.length
    days[days.length - 1]?.rows.push(...got.rows)
  }
  const older = items.length > shownTo ? x.m.act(t("chat.updates.panel.show.older"), () => x.setUi((u) => ({ ...u, limit: shownTo + PAGE }))) : ""
  const md = join([titled ? `# ${t("chat.events.updates")}` : "", ...days.map((d) => section(day(d.at), d.rows)), older, items.length ? "" : t("panes.page.empty")])
  return { md, at }
}

function build(channel: Channel, runs: readonly Message[][], target: number | null, titled: boolean, ui: Ui = FRESH, setUi: Dispatch<SetStateAction<Ui>> = () => {}) {
  const m = maker()
  const tasks = new Map(channel.tasks.map((k) => [k.id, k]))
  return { ...activityText({ channel, tasks, m, ui, target, setUi }, runs, titled), acts: m.acts }
}

export function activityMarkdown(channel: Channel, runs: readonly Message[][], target: number | null = null): string {
  return build(channel, runs, target, false).md
}

export function ActivityText({ channel, runs, target, titled = false }: { channel: Channel; runs: readonly Message[][]; target: number | null; titled?: boolean }) {
  const [ui, setUi] = useState<Ui>(FRESH)
  const built = useMemo(() => build(channel, runs, target, titled, ui, setUi), [channel, runs, target, ui, titled])
  const box = useRef<HTMLDivElement>(null)
  const spot = useRef(-1)
  useLayoutEffect(() => {
    spot.current = built.at
  }, [built.at])
  useEffect(() => {
    const el = box.current
    if (target === null || !el || spot.current < 0) return
    const reach = (): boolean => {
      const row = el.querySelectorAll(".pg-item")[spot.current]
      row?.scrollIntoView({ block: "center" })
      return !!row
    }
    if (reach()) return
    const watch = new MutationObserver(() => {
      if (reach()) watch.disconnect()
    })
    watch.observe(el, { childList: true, subtree: true })
    return () => watch.disconnect()
  }, [target])
  return (
    <div ref={box} className="activity">
      <PageText channel={channel} md={built.md} acts={built.acts} />
    </div>
  )
}

export function ActivityPage({ channel }: { channel: Channel }) {
  const activity = useActivity()
  return (
    <PageFrame kind="activity">
      <ActivityText channel={channel} runs={activity?.runs ?? NONE} target={activity?.target ?? null} titled />
    </PageFrame>
  )
}
