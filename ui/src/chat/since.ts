import type { Channel, Message, Task, Where } from "~/model"
import { sameWhere } from "~/nav"

export type SincePlace = { where: Where; count: number; who: string[]; last: Message }

export interface Since {
  seq: number
  at: number
  rooms: SincePlace[]
  dms: SincePlace[]
  tasks: { done: Task[]; doing: Task[]; waiting: Task[] }
}

const said = (m: Message): boolean => !m.system && !m.deleted && !m.pending && !m.failed

function place(messages: readonly Message[], where: Where, after: number, count?: number): SincePlace | null {
  const fresh = messages.filter((m) => m.seq > after && said(m) && sameWhere(m.where, where))
  const last = fresh.at(-1)
  if (!last) return null
  const who = [...new Set([...fresh].reverse().map((m) => m.from))]
  return { where, count: count ?? fresh.length, who, last }
}

export function sinceYouLeft(channel: Pick<Channel, "rooms" | "directs" | "theirs" | "messages" | "tasks">): Since | null {
  const marks = [...channel.rooms.filter((r) => r.unread > 0 && !r.muted).map((r) => r.seen ?? 0), ...channel.directs.filter((d) => d.unread > 0).map((d) => d.seen ?? 0)]
  if (!marks.length) return null
  const seq = Math.min(...marks)
  const first = channel.messages.find((m) => m.seq > seq && said(m))
  if (!first) return null
  const rooms = channel.rooms.flatMap((r) => (r.unread > 0 && !r.muted ? (place(channel.messages, { kind: "room", room: r.id }, r.seen ?? 0, r.unread) ?? []) : []))
  const mine = channel.directs.flatMap((d) => (d.unread > 0 ? (place(channel.messages, { kind: "dm", with: d.with }, d.seen ?? 0, d.unread) ?? []) : []))
  const theirs = channel.theirs.flatMap((t) => place(channel.messages, { kind: "theirs", between: t.between }, seq) ?? [])
  const dms = [...mine, ...theirs].sort((a, b) => b.last.seq - a.last.seq)
  const moved = channel.tasks.filter((t) => t.updatedAt >= first.at)
  const by = (s: (t: Task) => boolean) => moved.filter(s).sort((a, b) => b.updatedAt - a.updatedAt)
  const tasks = { done: by((t) => t.status === "done"), doing: by((t) => t.status === "doing" || t.status === "review"), waiting: by((t) => t.status === "waiting") }
  if (!rooms.length && !dms.length) return null
  return { seq, at: first.at, rooms, dms, tasks }
}
