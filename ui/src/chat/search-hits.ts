import { buildIndex, marks, rank, snippet, terms, type Index } from "@kiwi/core/search-rank.ts"

import { preview } from "~/chat/preview"
import type { Channel, Message, OlderHit, Task, Where } from "~/model"
import { between, nickname } from "~/names"

export type Hit = { kind: "task"; task: Task } | { kind: "message"; m: Message } | { kind: "older"; o: OlderHit }

const TASKS = 8
const MESSAGES = 50

const taskNumber = (query: string): number | null => {
  const id = /^t?(\d+)$/i.exec(query.trim())
  return id ? Number(id[1]) : null
}

export function messageIndex(channel: Pick<Channel, "messages" | "nicknames">): Index<Message> {
  return buildIndex(
    channel.messages
      .filter((m) => !m.system && !m.pending && m.text.trim())
      .map((m) => ({
        item: m,
        fields: [
          { text: m.text, weight: 1 },
          { text: nickname(channel, m.from), weight: 1 },
        ],
      }))
  )
}

function matchingTasks(tasks: Task[], query: string): Task[] {
  const id = taskNumber(query)
  if (id !== null) return tasks.filter((t) => t.id === id)
  return rank(buildIndex(tasks.map((t) => ({ item: t, fields: [{ text: t.title, weight: 1 }] }))), query)
    .sort((a, b) => Number(a.item.archived) - Number(b.item.archived) || b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    .map((r) => r.item)
}

export function searchHits(tasks: Task[], messages: Index<Message>, query: string): Hit[] {
  if (!terms(query).length) return []
  const found = rank(messages, query)
    .sort((a, b) => b.score - a.score || b.item.at - a.item.at)
    .slice(0, MESSAGES)
  return [
    ...matchingTasks(tasks, query)
      .slice(0, TASKS)
      .map((task): Hit => ({ kind: "task", task })),
    ...found.map((r): Hit => ({ kind: "message", m: r.item })),
  ]
}

export const hitKey = (hit: Hit): string => (hit.kind === "task" ? `task-${hit.task.id}` : hit.kind === "older" ? `older-${hit.o.seq}` : `message-${hit.m.seq}`)

export function whereLabel(channel: Pick<Channel, "rooms" | "nicknames">, where: Where): string {
  if (where.kind === "room") return `# ${channel.rooms.find((r) => r.id === where.room)?.name ?? where.room}`
  if (where.kind === "dm") return `@ ${nickname(channel, where.with)}`
  if (where.kind === "theirs") return between(channel, where.between)
  return `T${where.task}`
}

export function hitText(text: string, wanted: string[]): string {
  const plain = preview(text)
  return snippet(marks(plain, wanted).some((s) => s.hit) ? plain : text, wanted)
}
