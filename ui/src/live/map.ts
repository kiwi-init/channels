import type { JoinRequest, Member as RosterMember } from "@kiwi/core/membership.ts"
import { runsLine } from "@kiwi/core/membership.ts"
import { permissionAnswer } from "@kiwi/core/permission.ts"
import { describeEvent } from "@kiwi/core/format.ts"
import { FAILED, prLinks, taskPr } from "@kiwi/core/prs.ts"
import { GENERAL_ROOM, ignored, isQuiet, isReaction, type Message as Wire } from "@kiwi/core/protocol.ts"
import { canPost } from "@kiwi/core/scopes.ts"
import { answersDecisions, colorOf, heldBy, holdsWork, humanOf, isPerson, MAIN, placeKey, prChecks, prKey, tasksAwaitingPeople, type ChannelState, type Task as CoreTask } from "@kiwi/core/state.ts"
import type { GithubPr } from "@kiwi/core/state/github.ts"
import { permissionCode, permissionTitle } from "@/lib/permission-view"
import { reviewsFor } from "@/lib/task-actions"
import { roomOfMessage, roomSeenKey } from "@/lib/rooms"
import { canonicalHarness, harnessName } from "@/lib/harness"
import type { Online } from "@/lib/channel/online"
import type { Ask, Color, Direct, Harness, Image, Message, Person, PullRequest, Reaction, Room, Task, TaskStatus, Where } from "~/model"

type Seen = Readonly<Record<string, number>>

const HARNESS_OF: Record<string, Harness> = { "claude-code": "claude", codex: "codex", opencode: "opencode", gemini: "gemini", cursor: "cursor", grok: "grok" }

export function harnessOf(raw: string | undefined): Harness | undefined {
  const h = canonicalHarness(raw)
  return h ? (HARNESS_OF[h] ?? "other") : undefined
}

export function peopleOf(state: ChannelState, roster: readonly RosterMember[], online: ReadonlyMap<string, Online>, me: string, wakes: ReadonlySet<string>): Person[] {
  const byName = new Map(roster.filter((r) => r.active).map((r) => [r.name, r]))
  const doing = new Map<string, number>()
  for (const t of state.tasks.values()) if (t.owner && t.state === "doing" && !doing.has(t.owner)) doing.set(t.owner, t.id)
  return [...state.members.values()]
    .filter((m) => m.active && m.kind !== "computer")
    .map((m): Person => {
      const human = isPerson(m)
      const here = online.get(m.name)
      const record = byName.get(m.name)
      const raw = m.runs?.harness ?? m.card?.harness
      const harness = human ? undefined : harnessOf(raw)
      const sponsor = human ? undefined : (humanOf(state, m.name) ?? m.sponsor?.handle ?? m.sponsor?.name)
      const color: Color | null = colorOf(state, m.name)
      return {
        name: m.name,
        kind: human ? "human" : "agent",
        ...(m.display ? { display: m.display } : {}),
        ...(m.name === state.lead ? { role: "lead" } : m.owner ? { role: "owner" } : m.persona ? { role: m.persona.name } : {}),
        ...(color ? { color } : {}),
        owner: m.owner,
        you: m.name === me,
        presence: m.name === me || here ? (here?.activity?.state === "idle" ? "away" : "online") : "offline",
        typing: false,
        ...(harness ? { harness } : {}),
        ...(!human && raw ? { runs: harnessName(canonicalHarness(raw) ?? raw) } : {}),
        ...(!human && (m.runs?.model ?? here?.activity?.model ?? m.card?.model) ? { model: m.runs?.model ?? here?.activity?.model ?? m.card?.model } : {}),
        ...(record?.from?.label ? { machine: record.from.label } : m.card?.os ? { machine: m.card.os } : {}),
        ...(m.card?.repo ? { folder: m.card.repo } : {}),
        ...(m.persona ? { persona: m.persona.name } : {}),
        ...(sponsor ? { sponsor } : {}),
        ...(m.card?.note ? { about: m.card.note } : {}),
        ...(doing.has(m.name) ? { doing: doing.get(m.name) } : {}),
        ...(!m.owner && !canPost(m.scopes) ? { readOnly: true } : {}),
        ...(!human && wakes.has(m.name) ? { wakes: true } : {}),
        lastSeen: here?.at ?? m.lastSeen,
        joined: m.joined,
        messages: m.messages,
      }
    })
}

export function roomsOf(state: ChannelState, messages: readonly Wire[], me: string, seen: Seen, from: number): Room[] {
  const unread = new Map<string, number>()
  const mentions = new Map<string, number>()
  for (const m of messages) {
    if (m.kind === "event" || m.from === me || ignored(state.trust.get(m.seq))) continue
    if ((state.placeOf.get(m.seq) ?? MAIN).kind !== "main") continue
    const id = roomOfMessage(state, m)
    if (m.seq <= (seen[roomSeenKey(id)] ?? (id === GENERAL_ROOM ? 0 : from))) continue
    unread.set(id, (unread.get(id) ?? 0) + 1)
    if (mentionsYou(m, me)) mentions.set(id, (mentions.get(id) ?? 0) + 1)
  }
  const rooms = [...state.rooms.values()]
  const list = rooms.some((r) => r.id === GENERAL_ROOM) ? rooms : [{ id: GENERAL_ROOM, name: GENERAL_ROOM }, ...rooms]
  return list.map((r) => ({ id: r.id, name: r.name, unread: unread.get(r.id) ?? 0, mentions: mentions.get(r.id) ?? 0, seen: seen[roomSeenKey(r.id)] ?? (r.id === GENERAL_ROOM ? 0 : from) }))
}

export function directsOf(state: ChannelState, messages: readonly Wire[], me: string, seen: Seen): Direct[] {
  const at = new Map<string, number>()
  const unread = new Map<string, number>()
  const marks = new Map<string, number>()
  for (const m of messages) {
    const place = state.placeOf.get(m.seq)
    if (place?.kind !== "dm" || !place.with.includes(me) || ignored(state.trust.get(m.seq))) continue
    const other = place.with[0] === me ? place.with[1] : place.with[0]
    at.set(other, m.ts)
    marks.set(other, seen[placeKey(place)] ?? 0)
    if (m.from !== me && m.kind !== "event" && m.seq > (seen[placeKey(place)] ?? 0)) unread.set(other, (unread.get(other) ?? 0) + 1)
  }
  for (const s of state.places.values()) {
    if (s.place.kind !== "dm" || !s.place.with.includes(me)) continue
    const other = s.place.with[0] === me ? s.place.with[1] : s.place.with[0]
    if (!at.has(other)) at.set(other, 0)
  }
  return [...at].map(([name, last]) => ({ with: name, unread: unread.get(name) ?? 0, last, seen: marks.get(name) ?? 0 })).sort((a, b) => b.last - a.last)
}

const LEADING_MENTION = (me: string) => new RegExp(`(^|[^\\p{L}\\p{N}_.-])@${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_-])`, "u")

function mentionsYou(m: Wire, me: string): boolean {
  return m.from !== me && (!!m.to?.includes(me) || LEADING_MENTION(me).test(m.body))
}

const SUMMARISED = (m: Wire): boolean => m.ev?.op === "task.add" || (m.ev?.op === "task.update" && !!m.ev.state)

function nameIn(state: ChannelState, name: string): string {
  const m = state.members.get(name)
  return m?.display || name
}

function eventText(m: Wire, state: ChannelState): string {
  const ev = m.ev
  const who = nameIn(state, m.from)
  if (!ev) return m.body
  switch (ev.op) {
    case "hold.set":
      return ev.on ? `${who} paused the agents${ev.note ? `: ${ev.note}` : ""}` : `${who} let the agents carry on`
    case "charter.set":
      return ev.text ? `${who} set the goal` : `${who} cleared the goal`
    case "role.set":
      return ev.role ? `${nameIn(state, ev.member)} is ${ev.role} now` : `${nameIn(state, ev.member)} has no role now`
    default:
      return `${who} ${describeEvent(m, state)}`
  }
}

function eventTask(m: Wire): number | undefined {
  const ev = m.ev
  if (!ev) return undefined
  if (ev.op === "task.add") return m.seq
  return "task" in ev && typeof ev.task === "number" ? ev.task : undefined
}

function prOf(state: ChannelState, pr: GithubPr | { repo: string; number: number; url: string }): PullRequest {
  const real = "state" in pr ? pr : state.github.prs.get(prKey(pr.repo, pr.number))
  const checks = real ? prChecks(state.github, real) : []
  const failed = checks.some((c) => !!c.conclusion && FAILED.has(c.conclusion))
  const running = checks.some((c) => c.conclusion === undefined)
  return {
    repo: pr.repo,
    number: pr.number,
    title: real?.title ?? `${pr.repo}#${pr.number}`,
    url: real?.url ?? ("url" in pr && pr.url ? pr.url : `https://github.com/${pr.repo}/pull/${pr.number}`),
    state: real?.state ?? "open",
    checks: !checks.length ? "none" : failed ? "fail" : running ? "running" : "pass",
    ...(real?.additions !== undefined ? { additions: real.additions } : {}),
    ...(real?.deletions !== undefined ? { deletions: real.deletions } : {}),
  }
}

export interface Pending {
  key: number
  where: Where
  text: string
  at: number
  inThread?: number
  replyTo?: number
  seq?: number
  failed?: string
}

export interface Pictures {
  get(seq: number, i: number): Image | undefined
}

export function messagesOf(state: ChannelState, messages: readonly Wire[], me: string, askOf: ReadonlyMap<number, string>, pictures: Pictures, pending: readonly Pending[]): Message[] {
  const bySeq = new Map(messages.map((m) => [m.seq, m]))
  const threads = new Map<number, { replies: number; last: number; people: string[] }>()
  const rootOf = (m: Wire): number | undefined => {
    const root = state.threadOf.get(m.seq)
    if (root === undefined || root === m.seq) return undefined
    const r = bySeq.get(root)
    return r && r.kind !== "event" ? root : undefined
  }
  for (const m of messages) {
    if (m.kind === "event" || ignored(state.trust.get(m.seq))) continue
    const root = rootOf(m)
    if (root === undefined) continue
    const t = threads.get(root) ?? { replies: 0, last: 0, people: [] }
    t.replies++
    t.last = Math.max(t.last, m.ts)
    if (!t.people.includes(m.from)) t.people.push(m.from)
    threads.set(root, t)
  }
  const out: Message[] = []
  for (const m of messages) {
    if (ignored(state.trust.get(m.seq)) || isReaction(m)) continue
    if (m.kind === "event") {
      if (isQuiet(m)) continue
      const place = state.placeOf.get(m.seq) ?? MAIN
      if (place.kind === "dm") continue
      const where: Where = place.kind === "task" && !SUMMARISED(m) ? { kind: "task", task: place.task } : { kind: "room", room: GENERAL_ROOM }
      const task = eventTask(m)
      out.push({ seq: m.seq, from: m.from, at: m.ts, text: eventText(m, state), where, system: true, ...(task !== undefined ? { task } : {}) })
      continue
    }
    const place = state.placeOf.get(m.seq) ?? MAIN
    if (place.kind === "dm" && !place.with.includes(me)) continue
    const where: Where =
      place.kind === "task"
        ? { kind: "task", task: place.task }
        : place.kind === "dm"
          ? { kind: "dm", with: place.with[0] === me ? place.with[1] : place.with[0] }
          : { kind: "room", room: roomOfMessage(state, m) }
    const root = rootOf(m)
    const quoted = m.re?.[0]
    const reactions = reactionsOf(state, m.seq)
    const link = prLinks(m.body)[0]
    const images = (m.imgs ?? []).flatMap((_, i) => pictures.get(m.seq, i) ?? [])
    const ask = askOf.get(m.seq)
    out.push({
      seq: m.seq,
      from: m.from,
      at: m.ts,
      text: m.body,
      where,
      ...(root !== undefined ? { inThread: root } : {}),
      ...(quoted !== undefined && quoted !== root && bySeq.has(quoted) ? { replyTo: quoted } : {}),
      ...(threads.has(m.seq) ? { thread: threads.get(m.seq) } : {}),
      ...(m.kind === "done" && m.task !== undefined ? { task: m.task } : {}),
      ...(link ? { pr: prOf(state, link) } : {}),
      ...(images.length ? { images } : {}),
      ...(reactions.length ? { reactions } : {}),
      ...(ask ? { ask } : {}),
      ...(mentionsYou(m, me) ? { mentionsYou: true } : {}),
    })
  }
  for (const p of pending) {
    if (p.seq !== undefined && bySeq.has(p.seq)) continue
    out.push({
      seq: -p.key,
      from: me,
      at: p.at,
      text: p.text,
      where: p.where,
      ...(p.failed !== undefined ? { failed: p.failed } : { pending: true }),
      ...(p.inThread !== undefined ? { inThread: p.inThread } : {}),
      ...(p.replyTo !== undefined ? { replyTo: p.replyTo } : {}),
    })
  }
  return out
}

function reactionsOf(state: ChannelState, seq: number): Reaction[] {
  const on = state.reactions.get(seq)
  if (!on?.size) return []
  const chips = new Map<string, { by: string[]; first: number }>()
  for (const [name, r] of [...on].sort((a, b) => a[1].seq - b[1].seq)) {
    const chip = chips.get(r.emoji) ?? { by: [], first: r.seq }
    chip.by.push(name)
    chips.set(r.emoji, chip)
  }
  return [...chips].sort((a, b) => a[1].first - b[1].first).map(([emoji, c]) => ({ emoji, by: c.by }))
}

const STATUS: Record<CoreTask["state"], TaskStatus> = { todo: "todo", doing: "doing", review: "review", done: "done" }

export function tasksOf(state: ChannelState, held: ReadonlySet<number>): Task[] {
  const waiting = tasksAwaitingPeople(state)
  return [...state.tasks.values()].map((t): Task => {
    const linked = taskPr(state, t.id)
    return {
      id: t.id,
      title: t.title,
      ...(t.detail ? { detail: t.detail } : {}),
      status: t.state !== "done" && (waiting.has(t.id) || held.has(t.id)) ? "waiting" : STATUS[t.state],
      ...(t.owner ? { owner: t.owner } : {}),
      ...(t.review ? { reviewer: t.review === "*" ? "anyone" : t.review } : {}),
      createdBy: t.createdBy,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      ...(linked ? { pr: prOf(state, linked.pr) } : {}),
      notes: t.notes.map((n) => ({ by: n.by, at: n.ts, text: n.text })),
      rounds: t.rounds.map((r) => ({ n: r.n, by: r.by, at: r.result.kind === "open" || r.result.kind === "withdrawn" ? r.ts : r.result.ts, result: r.result.kind })),
      archived: !!t.archived,
    }
  })
}

interface AsksMap {
  asks: Ask[]
  askOf: Map<number, string>
  held: Set<number>
}

const isQuestion = (m: Wire): boolean => (m.kind === "ask" || m.kind === "blocking") && !m.permission && !m.handoff

export function asksOf(state: ChannelState, messages: readonly Wire[], me: string, owner: boolean, requests: readonly JoinRequest[]): AsksMap {
  const open = new Set(state.openAsks.filter((m) => holdsWork(state, m)).map((m) => m.seq))
  const decides = answersDecisions(state.members, me)
  const bySeq = new Map(messages.map((m) => [m.seq, m]))
  const replies = new Map<number, Wire[]>()
  for (const m of messages) for (const seq of m.re ?? []) replies.set(seq, [...(replies.get(seq) ?? []), m])
  const asks: Ask[] = []
  const askOf = new Map<number, string>()
  const held = new Set<number>()
  const folded = { trust: state.trust, members: state.members, bySeq }
  for (const m of messages) {
    if (m.from === me || ignored(state.trust.get(m.seq))) continue
    const place = state.placeOf.get(m.seq)
    const task = place?.kind === "task" ? place.task : m.task
    const id = String(m.seq)
    if (m.permission) {
      if (!m.to?.includes(me) && !owner) continue
      const said = (replies.get(m.seq) ?? []).map((r) => ({ r, a: permissionAnswer(m, r, folded) })).find((x) => x.a !== null)
      const isOpen = state.openAsks.some((a) => a.seq === m.seq)
      if (!isOpen && !said) continue
      if (isOpen) for (const t of heldBy(state, m)) held.add(t)
      if (isOpen && task !== undefined) held.add(task)
      asks.push({
        kind: "permission",
        id,
        from: m.from,
        at: m.ts,
        tool: m.permission.tool,
        summary: m.permission.description ?? permissionTitle(m.permission),
        code: permissionCode(m.permission),
        ...(task !== undefined ? { task } : {}),
        ...(said ? { answer: { allow: said.a === "allow", by: said.r.from, at: said.r.ts } } : {}),
      })
      askOf.set(m.seq, id)
      continue
    }
    if (!isQuestion(m)) continue
    const toMe = !m.to?.length || m.to.includes(me) || m.to.includes("*") || (decides && !!m.esc)
    if (!toMe) continue
    const answer = (replies.get(m.seq) ?? []).find((r) => r.from !== m.from && r.kind !== "event")
    const isOpen = open.has(m.seq)
    if (!isOpen && !answer) continue
    const holds = heldBy(state, m)
    if (isOpen) for (const t of holds) held.add(t)
    asks.push({
      kind: "question",
      id,
      from: m.from,
      at: m.ts,
      text: m.body,
      options: m.choices ?? [],
      holds,
      ...(task !== undefined ? { task } : {}),
      ...(!isOpen && answer ? { answer: { text: answer.body, by: answer.from, at: answer.ts } } : {}),
    })
    askOf.set(m.seq, id)
  }
  if (owner)
    for (const r of requests) {
      const harness = harnessOf(r.runs?.harness ?? r.card?.harness)
      asks.push({
        kind: "join",
        id: r.id,
        at: r.ts,
        name: r.display || r.name,
        who: r.kind === "human" ? "human" : "agent",
        ...(harness ? { harness } : {}),
        ...(r.runs ? { runs: runsLine({ harness: harnessName(r.runs.harness), model: r.runs.model }) } : r.card?.harness ? { runs: harnessName(r.card.harness) } : {}),
        ...(r.computer ? { machine: r.computer.label, sponsor: r.computer.personName } : r.card?.os ? { machine: r.card.os } : {}),
        code: r.check === "ready" && r.code ? r.code : "",
        check: r.check,
      })
    }
  const me_ = state.members.get(me)
  for (const t of reviewsFor(state.tasks.values(), me, !!me_ && isPerson(me_))) asks.push({ kind: "review", id: `review-${t.id}`, at: t.updatedAt, from: t.owner ?? t.createdBy, task: t.id })
  return { asks, askOf, held }
}
