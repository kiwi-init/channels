import type { Message } from "@kiwi/core/protocol.ts"
import { taskId, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { memberLoad } from "@kiwi/core/load.ts"
import type { SendOptions } from "@kiwi/core/client.ts"

import type { JoinRequest } from "@kiwi/core/membership.ts"

import { asksFor } from "../asks"
import { permissionOf } from "@/lib/permission-view"
import type { VoiceTool } from "./events"

export interface ToolCtx {
  state: ChannelState
  me: string
  channel: string
  isOwner: boolean
  online: ReadonlySet<string>
  requests: readonly Pick<JoinRequest, "id" | "name" | "display" | "role" | "kind" | "check" | "code">[]
  nameOf: (name: string) => string
  send: (body: string, opts: SendOptions) => Promise<number>
  hold?: (on: boolean, note?: string) => Promise<void>
  letIn?: (requestId: string) => Promise<void>
  approve?: (task: Task) => Promise<void>
  endCall?: () => void
}

export interface Verbs {
  pending: string | null
  spoke?: number
  heard?: string[]
  at?: { spoke: number; heard: number }
}

const YES = /\b(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|confirm|confirmed|please do|correct|that's right)\b/i

function readBack(verbs: Verbs, key: string | null, readback: string, extra: Record<string, unknown> = {}) {
  verbs.pending = key
  verbs.at = { spoke: verbs.spoke ?? 0, heard: verbs.heard?.length ?? 0 }
  return { readback, ...extra }
}

function unconfirmed(verbs: Verbs, key: string): string | null {
  const was = verbs.pending
  const at = verbs.at
  verbs.pending = null
  verbs.at = undefined
  if (was !== key || !at) return "Read it back first, then confirm."
  if ((verbs.spoke ?? 0) <= at.spoke) return "The person hasn't answered the readback yet: wait for them to say yes out loud."
  const said = (verbs.heard ?? []).slice(at.heard)
  if (said.length && !said.some((t) => YES.test(t))) return "The person didn't say yes to the readback."
  return null
}

type Args = Record<string, unknown>

const MAX_LIST = 15
const STATE_WORD: Record<Task["state"], string> = { todo: "open", doing: "in progress", review: "in review", done: "done" }
const WORD_STATE: Record<string, Task["state"]> = { open: "todo", "in progress": "doing", "in review": "review" }

const none = { type: "object" as const, properties: {} }

export const VOICE_TOOLS: VoiceTool[] = [
  { name: "channel_status", description: "Who is in the channel, who leads, which agents are working on what, whether it's paused, and how much waits on the person.", parameters: none },
  {
    name: "open_tasks",
    description: "The channel's open tasks, newest change first: id, title, state and owner.",
    parameters: { type: "object", properties: { state: { type: "string", enum: ["open", "in progress", "in review"], description: "Only tasks in this state." } } },
  },
  { name: "needs_you", description: "What waits on the person, oldest first: questions and decisions with their options, reviews, people asking to join.", parameters: none },
  {
    name: "post",
    description:
      "Post a message in the channel as the person, with words they asked you to post. Call with confirmed false for the readback, say it word for word, then confirmed true with the same text when they say yes.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" }, to: { type: "string", description: "A member's name, to address them." }, confirmed: { type: "boolean" } },
      required: ["text", "confirmed"],
    },
  },
  {
    name: "answer_ask",
    description:
      "Answer a question that waits on the person (its number from needs_you), with one of its options or their own words. Call with confirmed false for the readback, say it word for word, then confirmed true with the same answer when they say yes.",
    parameters: { type: "object", properties: { ask: { type: "number" }, answer: { type: "string" }, confirmed: { type: "boolean" } }, required: ["ask", "answer", "confirmed"] },
  },
  {
    name: "yes",
    description:
      "The person said yes with nothing else pending: call with confirmed false to get the top thing waiting on them and a readback, say the readback word for word, then call with confirmed true only when they say yes to it.",
    parameters: { type: "object", properties: { confirmed: { type: "boolean" } }, required: ["confirmed"] },
  },
  {
    name: "hold",
    description:
      "The person said hold: pause every agent (on), or let them carry on (off). Call with confirmed false for the readback, say it word for word, then confirmed true when they say yes. Only the channel's owner can.",
    parameters: { type: "object", properties: { on: { type: "boolean" }, note: { type: "string" }, confirmed: { type: "boolean" } }, required: ["on", "confirmed"] },
  },
  {
    name: "stop",
    description: "The person said stop: end this call. Call with confirmed false for the readback, say it, then confirmed true when they say yes.",
    parameters: { type: "object", properties: { confirmed: { type: "boolean" } }, required: ["confirmed"] },
  },
  {
    name: "enqueue_work",
    description:
      "Turn something the person wants done into a task on the board, for the lead to hand out. Call with confirmed false for the readback, say it word for word, then confirmed true with the same title when they say yes.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "A short title, under 80 characters." },
        detail: { type: "string", description: "What they said, in their words." },
        confirmed: { type: "boolean" },
      },
      required: ["title", "confirmed"],
    },
  },
]

function str(a: Args, k: string): string | undefined {
  const v = a[k]
  return typeof v === "string" && v.trim() ? v.trim() : undefined
}

function argsOf(x: unknown): Args {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Args) : {}
}

function taskLine(t: Task, nameOf: (n: string) => string) {
  return { id: taskId(t.id), title: t.title, state: STATE_WORD[t.state], ...(t.owner ? { owner: nameOf(t.owner) } : {}) }
}

function waiting(ctx: ToolCtx): Message[] {
  const { decisions, escalations, questions } = asksFor(ctx.state.openAsks, ctx.me)
  return [...decisions, ...escalations, ...questions].filter((m) => !permissionOf(m)).sort((a, b) => a.seq - b.seq)
}

function reviewsOf(ctx: ToolCtx): Task[] {
  return [...ctx.state.tasks.values()].filter((t) => t.state === "review" && (t.review === ctx.me || (t.review === "*" && !t.workedBy.includes(ctx.me))))
}

function status(ctx: ToolCtx) {
  const { state, nameOf } = ctx
  const members = [...state.members.values()].filter((m) => m.active)
  const agents = members
    .filter((m) => m.kind !== "human")
    .map((m) => {
      const load = memberLoad(state, m.name)
      return { name: nameOf(m.name), online: ctx.online.has(m.name), ...(load.current[0] ? { working_on: `${taskId(load.current[0].id)} ${load.current[0].title}` } : {}), queued: load.queued.length }
    })
  const open = [...state.tasks.values()].filter((t) => t.state !== "done" && !t.archived)
  return {
    channel: ctx.channel,
    ...(state.lead ? { lead: nameOf(state.lead) } : {}),
    paused: state.hold ? (state.hold.note ?? true) : false,
    people: members.filter((m) => m.kind === "human").map((m) => nameOf(m.name)),
    agents,
    open_tasks: open.length,
    in_progress: open.filter((t) => t.state === "doing").length,
    waiting_on_you: waiting(ctx).length + reviewsOf(ctx).length + (ctx.isOwner ? ctx.requests.length : 0),
  }
}

function openTasks(ctx: ToolCtx, a: Args) {
  const want = str(a, "state")
  const only = want ? WORD_STATE[want] : undefined
  const open = [...ctx.state.tasks.values()].filter((t) => t.state !== "done" && !t.archived && (!only || t.state === only)).sort((x, y) => y.updatedAt - x.updatedAt)
  return { count: open.length, tasks: open.slice(0, MAX_LIST).map((t) => taskLine(t, ctx.nameOf)) }
}

function needsYou(ctx: ToolCtx) {
  const asks = waiting(ctx).map((m) => ({
    kind: m.esc ? "decision" : "question",
    ask: m.seq,
    from: ctx.nameOf(m.from),
    text: m.body,
    ...(m.choices?.length ? { options: m.choices } : {}),
    ...(m.task ? { task: taskId(m.task) } : {}),
  }))
  const reviews = reviewsOf(ctx).map((t) => ({ kind: "review", ...taskLine(t, ctx.nameOf) }))
  const joins = ctx.isOwner ? ctx.requests.map((r) => ({ kind: "join", name: r.display || r.name })) : []
  return { count: asks.length + reviews.length + joins.length, items: [...joins, ...asks, ...reviews] }
}

async function post(ctx: ToolCtx, a: Args, verbs: Verbs) {
  const text = str(a, "text")
  if (!text) return { error: "Nothing to post." }
  const to = str(a, "to")
  const member = to ? [...ctx.state.members.values()].find((m) => m.active && (m.name === to || ctx.nameOf(m.name).toLowerCase() === to.toLowerCase())) : undefined
  if (to && !member) return { error: `No one here is called ${to}.` }
  const key = `post:${member?.name ?? ""}:${text}`
  if (a.confirmed !== true) return readBack(verbs, key, `Post “${text}”${member ? ` to ${ctx.nameOf(member.name)}` : ""}?`)
  const refused = unconfirmed(verbs, key)
  if (refused) return { error: refused }
  const seq = await ctx.send(text, { kind: "msg", ...(member ? { to: [member.name] } : {}) })
  return { posted: `#${seq}`, ...(member ? { to: ctx.nameOf(member.name) } : {}) }
}

async function answerAsk(ctx: ToolCtx, a: Args, verbs: Verbs) {
  const seq = typeof a.ask === "number" ? a.ask : Number(a.ask)
  const answer = str(a, "answer")
  const ask = waiting(ctx).find((m) => m.seq === seq)
  if (!ask) return { error: `#${a.ask} isn't a question waiting on ${ctx.nameOf(ctx.me)}.` }
  if (!answer) return { error: "No answer given." }
  const choice = ask.choices?.find((c) => c.trim().toLowerCase() === answer.toLowerCase() || c.trim().toLowerCase().startsWith(`${answer.toLowerCase()}:`))
  const key = `answer:${ask.seq}:${choice ?? answer}`
  if (a.confirmed !== true) return readBack(verbs, key, `Answer ${ctx.nameOf(ask.from)}'s question with “${choice ?? answer}”?`)
  const refused = unconfirmed(verbs, key)
  if (refused) return { error: refused }
  const sent = await ctx.send(choice ?? answer, { to: [ask.from], re: [ask.seq], kind: "msg" })
  return { answered: `#${ask.seq}`, with: choice ?? answer, message: `#${sent}` }
}

type Top = { key: string; readback: string; act: () => Promise<unknown> } | { key: string; readback: string; refuse: string }

function topNeed(ctx: ToolCtx): Top | null {
  const join = ctx.isOwner ? ctx.requests[0] : undefined
  if (join) {
    const who = join.display || join.name
    if (join.check !== "ready" || !join.code || !ctx.letIn)
      return { key: `join:${join.id}`, readback: `${who} wants to join, but its code isn't in yet.`, refuse: "Its code isn't in yet: let it in from the app once it is." }
    const digits = join.code.replace(/\D/g, "").split("").join(" ")
    const id = join.id
    const letIn = ctx.letIn
    return {
      key: `join:${id}`,
      readback: `${who} wants to join. Let ${join.kind === "human" ? "them" : "it"} in only if ${join.kind === "human" ? "they see" : "its terminal shows"} ${digits}. Say yes to let ${join.kind === "human" ? "them" : "it"} in.`,
      act: async () => (await letIn(id), { let_in: who }),
    }
  }
  const ask = waiting(ctx)[0]
  if (ask) {
    const from = ctx.nameOf(ask.from)
    if (ask.choices?.length)
      return { key: `ask:${ask.seq}`, readback: `${from} asks: ${ask.body} The options are: ${ask.choices.join("; ")}. Which one?`, refuse: "This one has options: ask which, then use answer_ask." }
    return {
      key: `ask:${ask.seq}`,
      readback: `${from} asks: ${ask.body} Say yes to answer yes.`,
      act: async () => ({ answered: `#${ask.seq}`, message: `#${await ctx.send("Yes", { to: [ask.from], re: [ask.seq], kind: "msg" })}` }),
    }
  }
  const t = reviewsOf(ctx)[0]
  if (t) {
    if (!ctx.approve) return { key: `review:${t.id}`, readback: `${taskId(t.id)}, ${t.title}, waits on your review.`, refuse: "Approve it from the app." }
    const approve = ctx.approve
    return {
      key: `review:${t.id}`,
      readback: `${taskId(t.id)}, ${t.title}${t.owner ? `, done by ${ctx.nameOf(t.owner)}` : ""}, is ready for your review. Say yes to approve it.`,
      act: async () => (await approve(t), { approved: taskId(t.id) }),
    }
  }
  return null
}

async function yes(ctx: ToolCtx, a: Args, verbs: Verbs) {
  const top = topNeed(ctx)
  if (a.confirmed !== true) return readBack(verbs, top && "act" in top ? top.key : null, top ? top.readback : `Nothing is waiting on ${ctx.nameOf(ctx.me)}.`)
  if (!top) return { error: "Nothing is waiting any more." }
  if (!("act" in top)) return { error: top.refuse }
  if (verbs.pending !== top.key) {
    verbs.pending = null
    return { error: "That wasn't read back, or the top item changed. Read back the new top item first.", readback: top.readback }
  }
  const refused = unconfirmed(verbs, top.key)
  if (refused) return { error: refused }
  return await top.act()
}

async function hold(ctx: ToolCtx, a: Args, verbs: Verbs) {
  if (!ctx.isOwner || !ctx.hold) return { error: "Only the channel's owner can pause the agents." }
  if (typeof a.on !== "boolean") return { error: "Say whether to pause (on) or carry on (off)." }
  const note = str(a, "note")
  const key = `hold:${a.on}`
  if (a.confirmed !== true) return readBack(verbs, key, a.on ? `Pause every agent${note ? ` for “${note}”` : ""}? They'll stop work until you let them carry on.` : "Let the agents carry on?")
  const refused = unconfirmed(verbs, key)
  if (refused) return { error: refused }
  await ctx.hold(a.on, note)
  return { paused: a.on }
}

function stop(ctx: ToolCtx, a: Args, verbs: Verbs) {
  if (a.confirmed !== true) return readBack(verbs, "stop", "End the call?")
  const refused = unconfirmed(verbs, "stop")
  if (refused || !ctx.endCall) return { error: refused ?? "Read it back first, then confirm." }
  ctx.endCall()
  return { ending: true }
}

async function enqueue(ctx: ToolCtx, a: Args, verbs: Verbs) {
  const title = str(a, "title")?.slice(0, 120)
  if (!title) return { error: "A task needs a title." }
  const detail = str(a, "detail")?.slice(0, 2000)
  const key = `task:${title}:${detail ?? ""}`
  if (a.confirmed !== true) return readBack(verbs, key, `Add a task: “${title}”?`)
  const refused = unconfirmed(verbs, key)
  if (refused) return { error: refused }
  const seq = await ctx.send(`added task ${title}`, { kind: "event", ev: { op: "task.add", title, ...(detail ? { detail } : {}) } })
  return { task: taskId(seq), title, for: ctx.state.lead ? ctx.nameOf(ctx.state.lead) : "whoever takes it" }
}

export async function runVoiceTool(name: string, raw: unknown, ctx: ToolCtx, verbs: Verbs = { pending: null }): Promise<unknown> {
  const a = argsOf(raw)
  try {
    switch (name) {
      case "channel_status":
        return status(ctx)
      case "open_tasks":
        return openTasks(ctx, a)
      case "needs_you":
        return needsYou(ctx)
      case "post":
        return await post(ctx, a, verbs)
      case "answer_ask":
        return await answerAsk(ctx, a, verbs)
      case "yes":
        return await yes(ctx, a, verbs)
      case "hold":
        return await hold(ctx, a, verbs)
      case "stop":
        return stop(ctx, a, verbs)
      case "enqueue_work":
        return await enqueue(ctx, a, verbs)
      default:
        return { error: `No tool called ${name}.` }
    }
  } catch (err) {
    // A failed send goes back to the model as words it can say, instead of leaving the call unanswered.
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
