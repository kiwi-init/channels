import { freeHandle, seededPick } from "@kiwi/core/handles.ts"
import type { JoinRequest, Member as RosterMember } from "@kiwi/core/membership.ts"
import { nameKey, runsLine } from "@kiwi/core/membership.ts"
import type { Card, Event } from "@kiwi/core/protocol.ts"
import { permissionAnswer } from "@kiwi/core/permission.ts"
import { describeEvent, proofLabel } from "@kiwi/core/format.ts"
import { memberLoad, showsLoad } from "@kiwi/core/load.ts"
import { checksOf, FAILED, prLinks, taskPr } from "@kiwi/core/prs.ts"
import { stageOf } from "@kiwi/core/stage.ts"
import { GENERAL_ROOM, ignored, isQuiet, isRasterMime, isReaction, type Message as Wire } from "@kiwi/core/protocol.ts"
import { rootOf } from "@kiwi/core/room-rules.ts"
import { pickFor, taskCandidates } from "@kiwi/core/routing.ts"
import { canPost } from "@kiwi/core/scopes.ts"
import { versionName } from "@kiwi/core/status.ts"
import {
  answersAsk,
  answersDecisions,
  colorOf,
  heldBy,
  holdsWork,
  humanOf,
  isPerson,
  MAIN,
  mayNameGoal,
  outsideRepos,
  placeKey,
  prChecks,
  prKey,
  releaseOf,
  tasksAwaitingPeople,
  type ChannelState,
  type Task as CoreTask,
} from "@kiwi/core/state.ts"
import type { GithubPr } from "@kiwi/core/state/github.ts"
import { decisionLabel } from "@kiwi/app/asks.ts"
import { handoffLabel } from "@kiwi/app/handoff.ts"
import { permissionCode, permissionNotes, permissionTitle, visibleText } from "@kiwi/app/permission-view.ts"
import { reviewsFor, taskActions } from "@kiwi/channel/task-actions.ts"
import { taskGroups } from "@kiwi/app/views.ts"
import { roomOfMessage, roomSeenKey } from "@kiwi/app/rooms.ts"
import { canonicalHarness, harnessName } from "@kiwi/app/harness.ts"
import type { Online } from "@kiwi/channel/online.ts"
import { howHere } from "@kiwi/channel/presence.ts"
import type {
  Activity,
  Ask,
  Color,
  Direct,
  Harness,
  Image,
  ImageSpot,
  JoinAsk,
  Load,
  Message,
  Person,
  PullRequest,
  Reaction,
  Room,
  Task,
  TaskEvent,
  TaskGroup,
  TaskMove,
  TaskStatus,
  TheirDirect,
  Upload,
  Where,
} from "~/model"
import { mentions } from "~/live/mention"
import { phraseOf } from "~/live/said"

type Seen = Readonly<Record<string, number>>

const HARNESS_OF: Record<string, Harness> = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
  gemini: "gemini",
  cursor: "cursor",
  grok: "grok",
  "kimi-code": "kimi",
  mimocode: "mimo",
  pi: "pi",
  "grok-bot": "grok-bot",
  zcode: "zcode",
}

export function harnessOf(raw: string | undefined): Harness | undefined {
  const h = canonicalHarness(raw)
  return h ? (HARNESS_OF[h] ?? "other") : undefined
}

type StateMember = ChannelState["members"] extends ReadonlyMap<string, infer M> ? M : never

const OS: Record<string, string> = { macos: "macOS", linux: "Linux", windows: "Windows" }

const specsOf = (card: Card): string => [[card.os && (OS[card.os] ?? card.os), card.arch].filter(Boolean).join(" "), card.cpu, card.memory].filter(Boolean).join(" · ")

function activityOf(here: Online | undefined): Activity | undefined {
  const a = here?.activity
  if (!a) return undefined
  return {
    state: a.state,
    ...(a.tool ? { tool: a.tool } : {}),
    ...(a.since ? { since: a.since } : {}),
    ...(a.context ? { context: a.context.window ? { used: a.context.used, window: a.context.window } : { used: a.context.used } } : {}),
  }
}

function loadOf(state: ChannelState, m: StateMember): Load | undefined {
  const l = memberLoad(state, m.name)
  if (!showsLoad(m, l)) return undefined
  return { level: l.level, doing: l.current.map((t) => t.id), queued: l.queued.map((t) => t.id), waiting: l.waiting.map((t) => t.id) }
}

function seatOfIn(state: ChannelState, m: StateMember): { seatOf?: string } {
  const root = rootOf(m.name, state.members)
  return root !== m.name && state.members.get(root)?.active ? { seatOf: root } : {}
}

function personOf(state: ChannelState, m: StateMember, record: RosterMember | undefined, here: Online | undefined, me: string, wakes: ReadonlyMap<string, boolean>): Person {
  const human = isPerson(m)
  const raw = m.runs?.harness ?? m.card?.harness
  const harness = human ? undefined : harnessOf(raw)
  const sponsor = human ? undefined : (humanOf(state, m.name) ?? m.sponsor?.handle ?? m.sponsor?.name)
  const color: Color | null = colorOf(state, m.name)
  const activity = human ? undefined : activityOf(here)
  const reach = human ? null : howHere(here)
  const specs = m.card ? specsOf(m.card) : ""
  const load = loadOf(state, m)
  return {
    name: m.name,
    kind: human ? "human" : "agent",
    ...(m.display ? { display: m.display } : {}),
    ...(m.name === state.lead ? { role: "lead" } : m.owner ? { role: "owner" } : m.persona ? { role: m.persona.name } : {}),
    ...(color ? { color } : {}),
    ...(human && m.picture ? { picture: `data:${m.picture.mime};base64,${m.picture.data}` } : {}),
    owner: m.owner,
    you: m.name === me,
    ...seatOfIn(state, m),
    presence: m.name === me || here ? (human && here?.activity?.state === "idle" ? "away" : "online") : "offline",
    ...(activity ? { activity } : {}),
    ...(reach && reach !== "unknown" ? { reach } : {}),
    ...(harness ? { harness } : {}),
    ...(!human && raw ? { runs: harnessName(canonicalHarness(raw) ?? raw) } : {}),
    ...(!human && (m.runs?.model ?? here?.activity?.model ?? m.card?.model) ? { model: m.runs?.model ?? here?.activity?.model ?? m.card?.model } : {}),
    ...(record?.from?.label ? { machine: record.from.label } : {}),
    ...(!human && specs ? { specs } : {}),
    ...(!human && m.card?.tools?.length ? { tools: m.card.tools } : {}),
    ...(m.card?.repo ? { repo: m.card.repo, outside: outsideRepos(state, m.card) } : {}),
    ...(m.card?.repo && m.card.branch ? { branch: m.card.branch } : {}),
    ...(m.persona ? { persona: m.persona.name } : {}),
    ...(sponsor ? { sponsor } : {}),
    ...(m.card?.note ? { about: m.card.note } : {}),
    ...(load ? { load } : {}),
    ...(!m.owner && !canPost(m.scopes) ? { readOnly: true } : {}),
    ...(!human && wakes.has(m.name) ? { wakes: wakes.get(m.name) === true } : {}),
    ...(human && record?.addsAgents ? { addsAgents: true } : {}),
    ...(human && record?.answersDecisions ? { answersDecisions: true } : {}),
    ...(human && record?.managesAgents ? { managesAgents: true } : {}),
    ...(m.ops ? { ops: m.ops } : {}),
    ...(here?.ops ? { opsLive: here.ops } : {}),
    lastSeen: here?.at ?? m.lastSeen,
    joined: m.joined,
    messages: m.messages,
  }
}

export function nextOf(state: ChannelState, now = Date.now()): string {
  const note = state.facts.get("next")
  return note && (!note.expires || note.expires > now) ? note.value.trim() : ""
}

export function peopleOf(state: ChannelState, roster: readonly RosterMember[], online: ReadonlyMap<string, Online>, me: string, wakes: ReadonlyMap<string, boolean>): Person[] {
  const byName = new Map(roster.filter((r) => r.active).map((r) => [r.name, r]))
  return [...state.members.values()].filter((m) => m.active && m.kind !== "computer").map((m) => personOf(state, m, byName.get(m.name), online.get(m.name), me, wakes))
}

export function formerOf(state: ChannelState, me: string): Person[] {
  return [...state.members.values()]
    .filter((m) => !m.active && m.kind !== "computer")
    .map((m) => ({ ...personOf(state, m, undefined, undefined, me, new Map()), presence: "offline" as const, left: true }))
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
  return list.map((r) => ({
    id: r.id,
    name: r.name,
    unread: unread.get(r.id) ?? 0,
    mentions: mentions.get(r.id) ?? 0,
    seen: seen[roomSeenKey(r.id)] ?? (r.id === GENERAL_ROOM ? 0 : from),
    ...("members" in r && r.members ? { members: r.members.map((m) => m.name) } : {}),
  }))
}

export function directsOf(state: ChannelState, messages: readonly Wire[], seat: string, seen: Seen): Direct[] {
  const me = rootOf(seat, state.members)
  const at = new Map<string, number>()
  const unread = new Map<string, number>()
  const marks = new Map<string, number>()
  for (const m of messages) {
    const place = state.placeOf.get(m.seq)
    if (place?.kind !== "dm" || !place.with.includes(me) || ignored(state.trust.get(m.seq))) continue
    const other = place.with[0] === me ? place.with[1] : place.with[0]
    at.set(other, m.ts)
    marks.set(other, seen[placeKey(place)] ?? 0)
    if (rootOf(m.from, state.members) !== me && m.kind !== "event" && m.seq > (seen[placeKey(place)] ?? 0)) unread.set(other, (unread.get(other) ?? 0) + 1)
  }
  for (const s of state.places.values()) {
    if (s.place.kind !== "dm" || !s.place.with.includes(me)) continue
    const other = s.place.with[0] === me ? s.place.with[1] : s.place.with[0]
    if (!at.has(other)) at.set(other, 0)
  }
  return [...at].map(([name, last]) => ({ with: name, unread: unread.get(name) ?? 0, last, seen: marks.get(name) ?? 0 })).sort((a, b) => b.last - a.last)
}

export function theirsOf(state: ChannelState, messages: readonly Wire[], seat: string): TheirDirect[] {
  const me = rootOf(seat, state.members)
  const at = new Map<string, { between: readonly [string, string]; last: number }>()
  for (const m of messages) {
    const place = state.placeOf.get(m.seq)
    if (place?.kind !== "dm" || place.with.includes(me) || m.kind === "event" || ignored(state.trust.get(m.seq))) continue
    at.set(placeKey(place), { between: place.with, last: m.ts })
  }
  return [...at.values()].sort((a, b) => b.last - a.last)
}

function mentionsYou(m: Wire, me: string): boolean {
  return m.from !== me && (!!m.to?.includes(me) || mentions(m.body, me))
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
  const refused = state.rejected.get(m.seq)
  if (refused !== undefined) return `${who}: refused: ${refused}`
  switch (ev.op) {
    case "hold.set":
      return ev.on ? `${who} paused the agents${ev.note ? `: ${ev.note}` : ""}` : `${who} let the agents carry on`
    case "charter.set":
      return ev.text ? `${who} set the goal` : `${who} cleared the goal`
    case "role.set":
      return ev.role ? `${nameIn(state, ev.member)} is ${ev.role} now` : `${nameIn(state, ev.member)} has no role now`
    default:
      return `${who} ${describeEvent(m, state, (handle) => nameIn(state, handle))}`
  }
}

function eventForYou(m: Wire, me: string): boolean {
  const ev = m.ev
  if (!ev || m.from === me) return false
  if (ev.op === "role.set" || ev.op === "role.refuse") return ev.member === me
  if (ev.op === "task.add" || ev.op === "task.update") return ev.owner === me
  return false
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
  const ticks = real ? checksOf(state, real) : undefined
  return {
    repo: pr.repo,
    number: pr.number,
    title: real?.title ?? `${pr.repo}#${pr.number}`,
    url: real?.url ?? ("url" in pr && pr.url ? pr.url : `https://github.com/${pr.repo}/pull/${pr.number}`),
    state: real?.state ?? "open",
    checks: !checks.length ? "none" : failed ? "fail" : running ? "running" : "pass",
    ...(ticks ? { ticks: { passed: ticks.passed, running: ticks.running, failed: ticks.failed } } : {}),
    ...(real?.state === "merged" ? { mergedAt: real.at } : {}),
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
  images?: Upload[]
}

export interface Pictures {
  get(seq: number, i: number, alt: string): Image | ImageSpot
}

function whereOf(state: ChannelState, m: Wire, seat: string): Where {
  const me = rootOf(seat, state.members)
  const place = state.placeOf.get(m.seq) ?? MAIN
  if (place.kind === "task") return { kind: "task", task: place.task }
  if (place.kind === "dm") return place.with.includes(me) ? { kind: "dm", with: place.with[0] === me ? place.with[1] : place.with[0] } : { kind: "theirs", between: place.with }
  return { kind: "room", room: roomOfMessage(state, m) }
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
      out.push({
        seq: m.seq,
        from: m.from,
        at: m.ts,
        text: eventText(m, state),
        where,
        system: true,
        ...(task !== undefined ? { task } : {}),
        ...(m.ev?.op === "github" ? { github: m.ev.items } : {}),
        ...(eventForYou(m, me) ? { mentionsYou: true } : {}),
      })
      continue
    }
    const where = whereOf(state, m, me)
    const root = rootOf(m)
    const quoted = m.re?.[0]
    const target = quoted === undefined ? undefined : bySeq.get(quoted)
    const reactions = reactionsOf(state, m.seq)
    const prs = prLinks(m.body).map((link) => prOf(state, link))
    const said = phraseOf(m, me, (name) => (name === me ? "you" : nameIn(state, name)), new Set((m.re ?? []).flatMap((seq) => bySeq.get(seq)?.from ?? [])))
    const images = (m.imgs ?? []).flatMap((img, i) => (isRasterMime(img.mime) ? [pictures.get(m.seq, i, img.name)] : []))
    const ask = askOf.get(m.seq)
    out.push({
      seq: m.seq,
      from: m.from,
      at: m.ts,
      text: m.body,
      where,
      ...(said ? { said } : {}),
      ...(root !== undefined ? { inThread: root } : {}),
      ...(quoted !== undefined && quoted !== root && target?.kind !== "event" ? { replyTo: quoted } : {}),
      ...(threads.has(m.seq) ? { thread: threads.get(m.seq) } : {}),
      ...(m.kind === "done" && m.task !== undefined && !state.rejected.has(m.seq) ? { task: m.task, done: true } : {}),
      ...(prs.length ? { prs } : {}),
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
      ...(p.images?.length ? { images: p.images.map((i) => ({ url: `data:${i.mime};base64,${i.data}`, width: 0, height: 0, alt: i.name })) } : {}),
    })
  }
  return out
}

export function leftOutOf(state: ChannelState, messages: readonly Wire[], me: string): Message[] {
  const out: Message[] = []
  for (const m of messages) {
    const trust = state.trust.get(m.seq)
    if (!ignored(trust) || isReaction(m)) continue
    const why = state.rejected.get(m.seq) ?? (trust === "forged" ? `not signed by ${m.from}'s key` : "not allowed here")
    const leftOut = `${trust === "forged" ? "Forged" : "Refused"}: ${why}`
    if (m.kind === "event")
      out.push({
        seq: m.seq,
        from: m.from,
        at: m.ts,
        text: `${nameIn(state, m.from)} ${describeEvent(m, state, (handle) => nameIn(state, handle))}`,
        where: { kind: "room", room: GENERAL_ROOM },
        system: true,
        leftOut,
      })
    else out.push({ seq: m.seq, from: m.from, at: m.ts, text: m.body, where: whereOf(state, m, me), leftOut })
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

const STATE_MOVES: Record<NonNullable<TaskUpdate["state"]>, TaskMove> = { todo: "reopened", doing: "started", review: "review", done: "done", blocked: "blocked", cancelled: "cancelled" }

const TASK_REF = /\bT(\d+)\b/g

type TaskUpdate = Extract<Event, { op: "task.update" }>

type Move = Pick<TaskEvent, "what" | "to" | "round" | "note">

const said = (note: string | undefined, quiet?: string): { note?: string } => {
  const clean = note?.trim()
  return clean && clean !== quiet ? { note: clean } : {}
}

function moveOf(state: ChannelState, m: Wire, ev: TaskUpdate): Move | null {
  if (ev.verdict) return { what: ev.verdict, ...(ev.round !== undefined ? { round: ev.round } : {}), ...said(ev.note, ev.verdict) }
  if (ev.state === "review") {
    const round = state.tasks.get(ev.task)?.rounds.find((r) => r.seq === m.seq)
    return { what: "review", ...(round ? { round: round.n } : {}), ...said(ev.note) }
  }
  if (ev.state === "cancelled") return { what: "cancelled", ...said(ev.note, "cancelled") }
  if (ev.owner && (!ev.state || ev.state === "todo")) return { what: "assigned", to: ev.owner, ...said(ev.note?.replace(/^assigned to \S+: /, "")) }
  if (ev.state) return { what: STATE_MOVES[ev.state], ...said(ev.note, ev.state) }
  if (ev.owner === null) return { what: "unassigned", ...said(ev.note) }
  if (ev.review !== undefined) return { what: "reviewer", ...(ev.review ? { to: ev.review } : {}), ...said(ev.note) }
  if (ev.title) return { what: "renamed", note: ev.title.trim() }
  if (ev.proof) return { what: "proof", note: proofLabel(ev.proof) }
  if (ev.note?.trim()) return { what: ev.checkpoint ? "checkpoint" : "note", note: ev.note.trim() }
  return null
}

function historyOf(state: ChannelState, messages: readonly Wire[], me: string): Map<number, TaskEvent[]> {
  const out = new Map<number, TaskEvent[]>()
  const named = new Set<string>()
  const add = (id: number, e: TaskEvent) => {
    if (!state.tasks.has(id)) return
    const list = out.get(id)
    if (list) list.push(e)
    else out.set(id, [e])
  }
  for (const m of messages) {
    if (ignored(state.trust.get(m.seq)) || isReaction(m) || state.rejected.has(m.seq)) continue
    const base = { seq: m.seq, by: m.from, at: m.ts }
    const ev = m.ev
    if (m.kind === "event") {
      if (ev?.op === "task.add") add(m.seq, { ...base, what: "created", ...(ev.owner ? { to: ev.owner } : {}) })
      else if (ev?.op === "task.claim") add(ev.task, { ...base, what: "took" })
      else if (ev?.op === "task.update") {
        const move = moveOf(state, m, ev)
        if (move) add(ev.task, { ...base, ...move })
      }
      continue
    }
    if (!m.body) continue
    const where = whereOf(state, m, me)
    if (where.kind === "theirs") continue
    const root = state.threadOf.get(m.seq) ?? m.seq
    for (const hit of m.body.matchAll(TASK_REF)) {
      const id = Number(hit[1])
      const key = `${id}:${root}`
      if ((where.kind === "task" && where.task === id) || named.has(key)) continue
      named.add(key)
      add(id, { ...base, what: "mention", where, root, note: m.body.slice(0, 600) })
    }
  }
  return out
}

function suggestionFor(state: ChannelState, t: CoreTask): { name: string; why: string } | undefined {
  if (t.owner || t.state === "done") return undefined
  const top = pickFor(taskCandidates(state, t.id))
  return top ? { name: top.name, why: top.reasons[0] ?? "has its context" } : undefined
}

export function tasksOf(state: ChannelState, held: ReadonlySet<number>, me: string, messages: readonly Wire[]): Task[] {
  const waiting = tasksAwaitingPeople(state)
  const you = state.members.get(me)
  const person = !!you && isPerson(you)
  const history = historyOf(state, messages, me)
  return [...state.tasks.values()].map((t): Task => {
    const stage = stageOf(state, t)
    const linked = taskPr(state, t.id)?.pr ?? stage.pr
    const release = stage.stage === "done" && stage.pr ? releaseOf(state.github, stage.pr) : undefined
    const can = taskActions(t, me, person)
    const review = can.kind === "open" && can.review !== "none" ? can.review : undefined
    const suggested = person ? suggestionFor(state, t) : undefined
    return {
      id: t.id,
      title: t.title,
      ...(t.detail ? { detail: t.detail } : {}),
      status: t.state !== "done" && (waiting.has(t.id) || held.has(t.id)) ? "waiting" : STATUS[t.state],
      ...(t.owner ? { owner: t.owner } : {}),
      ...(t.review ? { reviewer: t.review } : {}),
      createdBy: t.createdBy,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      ...(linked ? { pr: prOf(state, linked) } : {}),
      stage: stage.stage,
      ...(release ? { release: versionName(release.tag) } : {}),
      notes: t.notes.map((n) => ({ by: n.by, at: n.ts, text: n.text })),
      rounds: t.rounds.map((r) => ({
        n: r.n,
        by: r.by,
        ...(r.result.kind === "open" || r.result.kind === "withdrawn" ? { at: r.ts } : { judge: r.result.by, at: r.result.ts }),
        result: r.result.kind,
        ...(r.summary ? { summary: r.summary } : {}),
      })),
      history: history.get(t.id) ?? [],
      archived: !!t.archived,
      ...(t.cancelled ? { cancelled: true } : {}),
      ...(review ? { youReview: review } : {}),
      ...(suggested ? { suggested } : {}),
      ...(t.leftBy && !t.owner ? { leftBy: t.leftBy } : {}),
    }
  })
}

export function groupsOf(state: ChannelState, me: string, now = Date.now()): TaskGroup[] {
  return taskGroups(state, "everything", now).map((g): TaskGroup => {
    const tasks = g.tasks.map((t) => t.id)
    const h = g.head
    switch (h.kind) {
      case "ask":
        return {
          key: g.key,
          tasks,
          head: h.ask
            ? { kind: "ask", id: h.ask.id, by: h.ask.by, words: h.ask.words.trim(), ...(h.ask.goal ? { goal: h.ask.goal } : {}), mayName: mayNameGoal(state, me, h.ask) }
            : { kind: "unfiled" },
        }
      case "next":
        return { key: g.key, tasks, head: { kind: "next", ...(h.name ? { name: versionName(h.name) } : {}) } }
      case "release":
        return { key: g.key, tasks, head: { kind: "release", tag: versionName(h.tag), at: h.at } }
      case "cancelled":
        return { key: g.key, tasks, head: { kind: "cancelled" } }
    }
  })
}

interface AsksMap {
  asks: Ask[]
  askOf: Map<number, string>
  held: Set<number>
}

const isQuestion = (m: Wire): boolean => (m.kind === "ask" || m.kind === "blocking") && !m.permission

function saidOf(state: ChannelState, card: Card | undefined): JoinAsk["said"] {
  if (!card) return "nothing"
  const machine = specsOf(card)
  return {
    ...(machine ? { machine } : {}),
    ...(card.tools?.length ? { tools: card.tools } : {}),
    ...(card.repo ? { repo: card.branch ? `${card.repo}@${card.branch}` : card.repo } : {}),
    outside: outsideRepos(state, card),
  }
}

export function asksOf(
  state: ChannelState,
  messages: readonly Wire[],
  me: string,
  owner: boolean,
  requests: readonly JoinRequest[],
  roster: readonly RosterMember[],
  pins: ReadonlyMap<string, string | null>
): AsksMap {
  const open = new Set(state.openAsks.filter((m) => holdsWork(state, m)).map((m) => m.seq))
  const pending = new Set(state.openAsks.map((m) => m.seq))
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
      const human = humanOf(state, m.from)
      asks.push({
        kind: "permission",
        id,
        from: m.from,
        at: m.ts,
        expiresAt: m.permission.expiresAt,
        canAllow: human === me && m.permission.canAllow,
        canDeny: human === me || owner,
        ...(m.permission.canAllow && human && human !== me ? { allower: human } : {}),
        tool: m.permission.tool,
        title: permissionTitle(m.permission),
        ...(m.permission.description ? { summary: m.permission.description } : {}),
        code: permissionCode(m.permission),
        ...(m.permission.cwd ? { cwd: m.permission.cwd } : {}),
        notes: permissionNotes(m.permission),
        ...(m.permission.replaced !== undefined ? { replaced: visibleText(m.permission.replaced) } : {}),
        ...(m.permission.content !== undefined ? { content: visibleText(m.permission.content) } : {}),
        ...(task !== undefined ? { task } : {}),
        ...(said ? { answer: { allow: said.a === "allow", by: said.r.from, at: said.r.ts } } : {}),
      })
      askOf.set(m.seq, id)
      continue
    }
    if (!isQuestion(m)) continue
    const toMe = !m.to?.length || m.to.includes(me) || m.to.includes("*") || (decides && !!m.esc && !m.handoff)
    if (!toMe) continue
    const answer = (replies.get(m.seq) ?? []).find((r) => r.kind !== "event" && answersAsk(state.members, m, r.from))
    const isOpen = open.has(m.seq)
    const idle = !isOpen && !answer && pending.has(m.seq)
    if (!isOpen && !answer && !idle) continue
    const holds = heldBy(state, m)
    const askedOf = m.esc && !m.handoff && m.to?.length && !m.to.includes(me) && !m.to.includes("*") ? [...m.to] : undefined
    if (isOpen) for (const t of holds) held.add(t)
    asks.push({
      kind: "question",
      id,
      from: m.from,
      at: m.ts,
      text: m.body,
      label: m.handoff ? "Browser for you" : m.esc ? (askedOf ? decisionLabel(m).replace(/ for you$/, "") : decisionLabel(m)) : m.to?.includes(me) ? "Question for you" : "Question for everyone",
      ...(m.decision === "irreversible" ? { irreversible: true as const } : {}),
      options: m.choices ?? [],
      holds,
      ...(m.step ? { step: m.step } : {}),
      ...(m.handoff ? { handoff: { url: m.handoff.url, label: handoffLabel(m.handoff), expiresAt: m.handoff.expiresAt } } : {}),
      ...(task !== undefined ? { task } : {}),
      ...(idle ? { idle: true as const } : {}),
      ...(askedOf ? { askedOf } : {}),
      ...(!isOpen && answer ? { answer: { text: answer.body, by: answer.from, at: answer.ts } } : {}),
    })
    askOf.set(m.seq, id)
  }
  if (owner)
    for (const r of requests) {
      const harness = harnessOf(r.runs?.harness ?? r.card?.harness)
      const taken = r.kind !== "human" && roster.some((m) => m.active && m.pk !== r.pk && nameKey(m.name) === nameKey(r.name))
      asks.push({
        kind: "join",
        id: r.id,
        at: r.ts,
        name: r.display || r.name,
        who: r.kind === "human" ? "human" : "agent",
        ...(harness ? { harness } : {}),
        ...(r.kind === "human" ? (r.person ? { key: r.person.slice(0, 8) } : {}) : { said: saidOf(state, r.card) }),
        ...(r.pin ? { pin: { name: r.pin.name, persona: pins.get(r.id) } } : {}),
        ...(taken
          ? {
              freeName: freeHandle(
                roster.filter((m) => m.active),
                seededPick(r.pk)
              ),
            }
          : {}),
        ...(r.runs
          ? { runs: runsLine({ harness: harnessName(r.runs.harness), model: r.runs.model }) }
          : r.card?.harness || r.card?.model
            ? { runs: [r.card.harness && harnessName(r.card.harness), r.card.model].filter(Boolean).join(" · ") }
            : {}),
        ...(r.computer ? { machine: r.computer.label, sponsor: r.computer.personName } : r.card?.os ? { machine: r.card.os } : {}),
        ...(r.computer?.forgotten ? { forgotten: true as const } : {}),
        code: r.check === "ready" && r.code ? r.code : "",
        check: r.check,
      })
    }
  const me_ = state.members.get(me)
  for (const t of reviewsFor(state.tasks.values(), me, !!me_ && isPerson(me_))) asks.push({ kind: "review", id: `review-${t.id}`, at: t.updatedAt, from: t.owner ?? t.createdBy, task: t.id })
  return { asks, askOf, held }
}
