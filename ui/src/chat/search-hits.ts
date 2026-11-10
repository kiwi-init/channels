import { buildIndex, countWords, indexOf, marks, rank, snippet, terms, type Counted, type Index } from "@kiwi/core/search-rank.ts"

import { preview } from "~/chat/preview"
import type { Channel, Message, OlderHit, Task, Where } from "~/model"
import { between, nickname } from "~/names"
import { wordsPlain, wordsRaw } from "~/words"

export type Hit = { kind: "task"; task: Task } | { kind: "message"; m: Message } | { kind: "older"; o: OlderHit } | { kind: "fetch" }

const TASKS = 8
const MESSAGES = 50

const taskNumber = (query: string): number | null => {
  const id = /^t?(\d+)$/i.exec(query.trim())
  return id ? Number(id[1]) : null
}

let counted: { names: string; bySeq: Map<number, { raw: string; from: string; words: Counted }> } = { names: "", bySeq: new Map() }

export function messageIndex(channel: Pick<Channel, "messages" | "nicknames">): Index<Message> {
  const names = [...channel.nicknames].join()
  const before = counted.names === names ? counted.bySeq : null
  const bySeq: typeof counted.bySeq = new Map()
  const docs: ({ item: Message } & Counted)[] = []
  for (const m of channel.messages) {
    const raw = wordsRaw(m.text)
    if (m.system || m.pending || !raw.trim()) continue
    const was = before?.get(m.seq)
    const words =
      was && was.raw === raw && was.from === m.from
        ? was.words
        : countWords([
            { text: wordsPlain(m.text, channel.nicknames), weight: 1 },
            { text: nickname(channel, m.from), weight: 1 },
          ])
    bySeq.set(m.seq, { raw, from: m.from, words })
    docs.push({ item: m, ...words })
  }
  counted = { names, bySeq }
  return indexOf(docs)
}

function matchingTasks(tasks: Task[], query: string): Task[] {
  const id = taskNumber(query)
  if (id !== null) return tasks.filter((t) => t.id === id)
  return rank(buildIndex(tasks.map((t) => ({ item: t, fields: [{ text: wordsRaw(t.title), weight: 1 }] }))), query)
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

export function hitKey(hit: Hit): string {
  if (hit.kind === "task") return `task-${hit.task.id}`
  if (hit.kind === "older") return `older-${hit.o.seq}`
  if (hit.kind === "fetch") return "fetch"
  return `message-${hit.m.seq}`
}

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
