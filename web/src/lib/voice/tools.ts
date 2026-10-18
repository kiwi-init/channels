import type { Message } from "@kiwi/core/protocol.ts"
import { taskId, type ChannelState, type Task } from "@kiwi/core/state.ts"
import { memberLoad } from "@kiwi/core/load.ts"
import type { SendOptions } from "@kiwi/core/client.ts"

import { asksFor } from "../asks"
import type { VoiceTool } from "./events"

export interface ToolCtx {
  state: ChannelState
  me: string
  channel: string
  isOwner: boolean
  online: ReadonlySet<string>
  requests: readonly { name: string; display?: string }[]
  nameOf: (name: string) => string
  send: (body: string, opts: SendOptions) => Promise<number>
  hold?: (on: boolean, note?: string) => Promise<void>
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
    description: "Post a message in the channel as the person. Only with words they asked you to post, read back to them and confirmed.",
    parameters: { type: "object", properties: { text: { type: "string" }, to: { type: "string", description: "A member's name, to address them." } }, required: ["text"] },
  },
  {
    name: "answer_ask",
    description: "Answer a question that waits on the person (its number from needs_you), with one of its options or their own words. Only after reading the answer back and hearing yes.",
    parameters: { type: "object", properties: { ask: { type: "number" }, answer: { type: "string" } }, required: ["ask", "answer"] },
  },
  {
    name: "hold",
    description: "Pause every agent (on) or let them carry on (off). Only the channel's owner can, and only after they confirmed.",
    parameters: { type: "object", properties: { on: { type: "boolean" }, note: { type: "string" } }, required: ["on"] },
  },
  {
    name: "enqueue_work",
    description: "Turn something the person wants done into a task on the board, for the lead to hand out.",
    parameters: {
      type: "object",
      properties: { title: { type: "string", description: "A short title, under 80 characters." }, detail: { type: "string", description: "What they said, in their words." } },
      required: ["title"],
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
  return [...decisions, ...escalations, ...questions].sort((a, b) => a.seq - b.seq)
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
  return { count: asks.length + reviews.length + joins.length, items: [...asks, ...reviews, ...joins] }
}

async function post(ctx: ToolCtx, a: Args) {
  const text = str(a, "text")
  if (!text) return { error: "Nothing to post." }
  const to = str(a, "to")
  const member = to ? [...ctx.state.members.values()].find((m) => m.active && (m.name === to || ctx.nameOf(m.name).toLowerCase() === to.toLowerCase())) : undefined
  if (to && !member) return { error: `No one here is called ${to}.` }
  const seq = await ctx.send(text, { kind: "msg", ...(member ? { to: [member.name] } : {}) })
  return { posted: `#${seq}`, ...(member ? { to: ctx.nameOf(member.name) } : {}) }
}

async function answerAsk(ctx: ToolCtx, a: Args) {
  const seq = typeof a.ask === "number" ? a.ask : Number(a.ask)
  const answer = str(a, "answer")
  const ask = waiting(ctx).find((m) => m.seq === seq)
  if (!ask) return { error: `#${a.ask} isn't a question waiting on ${ctx.nameOf(ctx.me)}.` }
  if (!answer) return { error: "No answer given." }
  const choice = ask.choices?.find((c) => c.trim().toLowerCase() === answer.toLowerCase() || c.trim().toLowerCase().startsWith(`${answer.toLowerCase()}:`))
  const sent = await ctx.send(choice ?? answer, { to: [ask.from], re: [ask.seq], kind: "msg" })
  return { answered: `#${ask.seq}`, with: choice ?? answer, message: `#${sent}` }
}

async function hold(ctx: ToolCtx, a: Args) {
  if (!ctx.isOwner || !ctx.hold) return { error: "Only the channel's owner can pause the agents." }
  if (typeof a.on !== "boolean") return { error: "Say whether to pause (on) or carry on (off)." }
  await ctx.hold(a.on, str(a, "note"))
  return { paused: a.on }
}

async function enqueue(ctx: ToolCtx, a: Args) {
  const title = str(a, "title")?.slice(0, 120)
  if (!title) return { error: "A task needs a title." }
  const detail = str(a, "detail")?.slice(0, 2000)
  const seq = await ctx.send(`added task ${title}`, { kind: "event", ev: { op: "task.add", title, ...(detail ? { detail } : {}) } })
  return { task: taskId(seq), title, for: ctx.state.lead ? ctx.nameOf(ctx.state.lead) : "whoever takes it" }
}

export async function runVoiceTool(name: string, raw: unknown, ctx: ToolCtx): Promise<unknown> {
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
        return await post(ctx, a)
      case "answer_ask":
        return await answerAsk(ctx, a)
      case "hold":
        return await hold(ctx, a)
      case "enqueue_work":
        return await enqueue(ctx, a)
      default:
        return { error: `No tool called ${name}.` }
    }
  } catch (err) {
    // A failed send goes back to the model as words it can say, instead of leaving the call unanswered.
    return { error: err instanceof Error ? err.message : String(err) }
  }
}
