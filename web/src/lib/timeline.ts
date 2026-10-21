import { inlineText } from "@kiwi/core/membership.ts"
import { ignored, type Message, type TaskState } from "@kiwi/core/protocol.ts"
import { free, take } from "@kiwi/core/state/leases.ts"
import type { Lease } from "@kiwi/core/state/types.ts"
import { isPerson, prChecks, taskId, type ChannelState } from "@kiwi/core/state.ts"
import { FAILED, prsByTask, taskPr, type PrRef } from "@kiwi/core/work.ts"
import { permissionTitle } from "./permission-view"

export type SpanKind = "doing" | "waiting" | "reviewing" | "decide" | "done"

export interface Span {
  key: string
  lane: string
  task: number
  title: string
  kind: SpanKind
  from: number
  to: number
  open: boolean
  round?: number
  pr?: PrRef
  by?: string
}

export type HandoffKind = "assign" | "review" | "back" | "approved" | "ask" | "question" | "follow"

export interface Handoff {
  key: string
  kind: HandoffKind
  task?: number
  from: { lane: string; at: number }
  to: { lane: string; at: number }
}

export type FlagKind = "ask" | "permission" | "red" | "running" | "merged"

export interface Flag {
  key: string
  kind: FlagKind
  lane: string
  at: number
  task?: number
  seq?: number
  text: string
  open: boolean
}

export interface Rail {
  key: string
  lane: string
  name: string
  from: number
  to: number
  holding: boolean
}

export interface Timeline {
  from: number
  to: number
  spans: Span[]
  handoffs: Handoff[]
  flags: Flag[]
  rails: Rail[]
  looked?: number
}

const at = (m: Message) => m.rts ?? m.ts

const stateOf = (s: TaskState | "blocked" | "cancelled"): TaskState => (s === "blocked" ? "doing" : s === "cancelled" ? "done" : s)

const TASK_REF = /\bT(\d{1,6})\b/

function taskOfAsk(m: Message): number | undefined {
  if (m.task !== undefined) return m.task
  const hit = TASK_REF.exec(m.body)
  return hit ? Number(hit[1]) : undefined
}

interface Holding {
  owner?: string
  state: TaskState
  since: number
  round?: number
  reviewer?: string
}

export function timeline(state: ChannelState, messages: Message[], me: string, now: number, windowMs: number): Timeline {
  const from = now - windowMs
  const spans: Span[] = []
  const handoffs: Handoff[] = []
  const flags: Flag[] = []
  const rails: Rail[] = []
  const prs = prsByTask(state, messages)
  const prOf = (id: number) => {
    const all = prs.get(id) ?? []
    return all.findLast((p) => p.state === "open") ?? all.at(-1)
  }
  const titleOf = (id: number) => state.tasks.get(id)?.title ?? taskId(id)
  const people = new Set([...state.members.values()].filter((m) => isPerson(m)).map((m) => m.name))
  const live = new Map<number, Holding>()
  const reviewing = new Map<number, { lane: string; since: number; round: number; by?: string }>()
  const leases = new Map<string, Lease>()
  const held = new Map<string, { lane: string; since: number; holding: boolean }>()
  let looked: number | undefined

  const close = (id: number, h: Holding, t: number) => {
    if (!h.owner || h.state === "todo") return
    spans.push({
      key: `${id}-${h.since}-${h.owner}`,
      lane: h.owner,
      task: id,
      title: titleOf(id),
      kind: h.state === "review" ? "waiting" : h.state === "done" ? "done" : "doing",
      from: h.since,
      to: t,
      open: false,
      ...(h.round ? { round: h.round } : {}),
    })
  }
  const closeReview = (id: number, t: number, lane?: string) => {
    const r = reviewing.get(id)
    if (!r) return
    reviewing.delete(id)
    spans.push({
      key: `r${id}-${r.round}`,
      lane: lane ?? r.lane,
      task: id,
      title: titleOf(id),
      kind: people.has(lane ?? r.lane) ? "decide" : "reviewing",
      from: r.since,
      to: t,
      open: false,
      round: r.round,
      ...(r.by ? { by: r.by } : {}),
    })
  }
  const railKey = (name: string, lane: string) => `${name}:${lane}`
  const syncRails = (lease: Lease, t: number) => {
    const now = new Map<string, boolean>()
    if (lease.holder) now.set(lease.holder, true)
    for (const q of lease.queue) now.set(q.name, false)
    for (const [k, h] of held) {
      if (!k.startsWith(`${lease.name}:`)) continue
      if (now.get(h.lane) === h.holding) {
        now.delete(h.lane)
        continue
      }
      rails.push({ key: `${k}-${h.since}`, lane: h.lane, name: lease.name, from: h.since, to: t, holding: h.holding })
      held.delete(k)
    }
    for (const [lane, holding] of now) held.set(railKey(lease.name, lane), { lane, since: t, holding })
  }

  for (const m of messages) {
    if (ignored(state.trust.get(m.seq)) || state.rejected.has(m.seq)) continue
    const t = at(m)
    if (m.from === me && m.kind !== "event") looked = t
    const ev = m.ev
    if (!ev) continue
    if (ev.op === "task.add") {
      const h: Holding = { state: "todo", since: t, ...(ev.owner ? { owner: ev.owner } : {}) }
      live.set(m.seq, h)
      if (ev.from !== undefined && live.has(ev.from)) {
        const src = live.get(ev.from)!
        if (src.owner) handoffs.push({ key: `f${m.seq}`, kind: "follow", task: m.seq, from: { lane: src.owner, at: t }, to: { lane: ev.owner ?? m.from, at: t } })
      }
    } else if (ev.op === "task.claim") {
      const h = live.get(ev.task)
      if (!h) continue
      if (h.owner !== m.from || h.state === "todo") {
        close(ev.task, h, t)
        live.set(ev.task, { owner: m.from, state: "doing", since: t })
      }
    } else if (ev.op === "task.update") {
      const h = live.get(ev.task)
      if (!h) continue
      const owner = ev.owner === undefined ? h.owner : (ev.owner ?? undefined)
      const next = ev.state ? stateOf(ev.state) : h.state
      if (owner === h.owner && next === h.state) continue
      close(ev.task, h, t)
      const task = state.tasks.get(ev.task)
      if (owner !== h.owner && h.owner && owner) handoffs.push({ key: `o${m.seq}`, kind: "assign", task: ev.task, from: { lane: h.owner, at: t }, to: { lane: owner, at: t } })
      if (next === "review" && h.state !== "review") {
        const round = task?.rounds.find((r) => r.seq === m.seq)
        const lane = round?.result.kind === "approved" || round?.result.kind === "rejected" ? round.result.by : task?.review && task.review !== "*" ? task.review : undefined
        if (lane && round) {
          reviewing.set(ev.task, { lane, since: t, round: round.n, ...(owner ? { by: owner } : {}) })
          if (owner) handoffs.push({ key: `v${m.seq}`, kind: "review", task: ev.task, from: { lane: owner, at: t }, to: { lane, at: t } })
        }
      }
      if (h.state === "review" && next !== "review") {
        const r = reviewing.get(ev.task)
        closeReview(ev.task, t, ev.verdict ? m.from : undefined)
        const by = ev.verdict ? m.from : r?.lane
        if (by && owner && by !== owner) handoffs.push({ key: `b${m.seq}`, kind: next === "done" ? "approved" : "back", task: ev.task, from: { lane: by, at: t }, to: { lane: owner, at: t } })
      }
      live.set(ev.task, { ...(owner ? { owner } : {}), state: next, since: t, ...(next === "review" && task ? { round: task.rounds.findLast((r) => r.seq <= m.seq)?.n ?? 1 } : {}) })
    } else if (ev.op === "lease.take" || ev.op === "lease.free") {
      let lease = leases.get(ev.name)
      if (ev.op === "lease.take") {
        if (!lease) leases.set(ev.name, (lease = { name: ev.name, since: t, until: t, queue: [] }))
        take(lease, m.from, ev.ttl * 1000, t, ev.note)
      } else if (lease) free(lease, m.from, t, people.has(m.from))
      if (lease) syncRails(lease, t)
    }
  }

  for (const [id, h] of live) {
    if (!h.owner || h.state === "todo") continue
    if (h.state === "done") {
      if (h.since >= from) {
        const pr = prOf(id)
        flags.push({ key: `m${id}`, kind: "merged", lane: h.owner, at: h.since, task: id, text: pr?.state === "merged" ? `PR #${pr.number} merged` : `${taskId(id)} done`, open: false })
      }
      continue
    }
    const pr = prOf(id)
    spans.push({
      key: `${id}-${h.since}-${h.owner}`,
      lane: h.owner,
      task: id,
      title: titleOf(id),
      kind: h.state === "review" ? "waiting" : "doing",
      from: h.since,
      to: now,
      open: true,
      ...(h.round ? { round: h.round } : {}),
      ...(pr ? { pr } : {}),
    })
    const r = reviewing.get(id)
    if (r)
      spans.push({
        key: `r${id}-${r.round}`,
        lane: r.lane,
        task: id,
        title: titleOf(id),
        kind: people.has(r.lane) ? "decide" : "reviewing",
        from: r.since,
        to: now,
        open: true,
        round: r.round,
        ...(r.by ? { by: r.by } : {}),
      })
    const gh = taskPr(state, id)
    if (gh) {
      const runs = prChecks(state.github, gh.pr)
      const red = runs.filter((c) => c.conclusion && FAILED.has(c.conclusion))
      const running = runs.filter((c) => !c.conclusion)
      if (red.length) flags.push({ key: `c${id}`, kind: "red", lane: h.owner, at: Math.max(...red.map((c) => c.at)), task: id, text: red.map((c) => c.name).join(", "), open: true })
      else if (running.length) flags.push({ key: `c${id}`, kind: "running", lane: h.owner, at: Math.min(...running.map((c) => c.at)), task: id, text: `${running.length} running`, open: true })
    }
  }
  for (const [k, h] of held) rails.push({ key: `${k}-${h.since}`, lane: h.lane, name: k.slice(0, k.indexOf(":")), from: h.since, to: now, holding: h.holding })

  for (const m of state.openAsks) {
    if (ignored(state.trust.get(m.seq)) || people.has(m.from)) continue
    const toPerson = !m.to?.length || m.to.some((n) => people.has(n) || n === "*")
    if (!toPerson) {
      const target = m.to?.find((n) => !people.has(n))
      if (target)
        handoffs.push({ key: `q${m.seq}`, kind: "question", ...(taskOfAsk(m) !== undefined ? { task: taskOfAsk(m)! } : {}), from: { lane: m.from, at: at(m) }, to: { lane: target, at: at(m) } })
      continue
    }
    const task = taskOfAsk(m)
    const permission = m.permission && now <= m.permission.expiresAt ? m.permission : undefined
    const text = permission ? `${permissionTitle(permission)}${permission.command ? `: ${inlineText(permission.command, 60)}` : ""}` : inlineText(m.body, 120)
    flags.push({
      key: `n${m.seq}`,
      kind: permission ? "permission" : "ask",
      lane: m.from,
      at: at(m),
      ...(task !== undefined && state.tasks.has(task) ? { task } : {}),
      seq: m.seq,
      text,
      open: true,
    })
    spans.push({ key: `d${m.seq}`, lane: me, task: task ?? 0, title: text, kind: "decide", from: at(m), to: now, open: true, by: m.from })
    handoffs.push({ key: `h${m.seq}`, kind: "ask", ...(task !== undefined ? { task } : {}), from: { lane: m.from, at: at(m) }, to: { lane: me, at: at(m) } })
  }

  const inWindow = <T extends { to: number }>(x: T) => x.to >= from
  return {
    from,
    to: now,
    spans: spans.filter(inWindow).sort((a, b) => a.from - b.from),
    handoffs: handoffs.filter((h) => h.to.at >= from),
    flags: flags.filter((f) => f.open || f.at >= from),
    rails: rails.filter(inWindow),
    ...(looked !== undefined && looked >= from ? { looked } : {}),
  }
}

export interface TaskTrack {
  task: number
  title: string
  spans: Span[]
  flags: Flag[]
  holder?: string
  since: number
}

export function byTask(t: Timeline): TaskTrack[] {
  const tracks = new Map<number, TaskTrack>()
  for (const s of t.spans) {
    if (!s.task) continue
    let track = tracks.get(s.task)
    if (!track) tracks.set(s.task, (track = { task: s.task, title: s.title, spans: [], flags: [], since: s.from }))
    track.spans.push(s)
  }
  for (const track of tracks.values()) track.spans = batons(track.spans)
  for (const f of t.flags) if (f.task) tracks.get(f.task)?.flags.push(f)
  for (const track of tracks.values()) {
    const now = track.spans.filter((s) => s.open)
    const holder = now.find((s) => s.kind === "decide" || s.kind === "reviewing") ?? now.find((s) => s.kind === "doing") ?? now[0]
    if (holder) {
      track.holder = holder.lane
      track.since = holder.from
    }
  }
  return [...tracks.values()].sort((a, b) => Number(!!b.holder) - Number(!!a.holder) || (a.spans[0]?.from ?? 0) - (b.spans[0]?.from ?? 0))
}

export function pack(spans: Span[], gap: number): { rowOf: Map<string, number>; rows: number } {
  const ends: number[] = []
  const rowOf = new Map<string, number>()
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    let r = ends.findIndex((end) => end + gap <= s.from)
    if (r < 0) r = ends.push(s.to) - 1
    else ends[r] = s.to
    rowOf.set(s.key, r)
  }
  return { rowOf, rows: Math.max(1, ends.length) }
}

export function batons(spans: Span[]): Span[] {
  const active = spans.filter((s) => s.kind === "reviewing" || s.kind === "decide")
  return spans.filter((s) => s.kind !== "waiting" || !active.some((a) => a.task === s.task && a.from < s.to && s.from < a.to))
}
