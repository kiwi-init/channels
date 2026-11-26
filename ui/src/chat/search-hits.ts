import { buildIndex, countWords, indexOf, marks, rank, snippet, terms, type Counted, type Index } from "@kiwi/core/search-rank.ts"

import { preview } from "~/chat/preview"
import type { Channel, Message, OlderHit, Task, Where } from "~/model"
import { between, nickname } from "~/names"
import { titleRank } from "~/tasks/title-rank"
import { wordsPlain, wordsRaw, wrote } from "~/words"

export type Hit = { kind: "task"; task: Task } | { kind: "message"; m: Message } | { kind: "older"; o: OlderHit } | { kind: "fetch" } | { kind: "meaning" }

export type MeaningPool = { items: { id: number; from: string; where: string; text: string }[]; hits: Map<number, Hit> }

export const MEANING_SURE = 0.45
export const MEANING_SHOWN = 8
const MEANING_RECENT = 120
const MEANING_MOST = 160
const MEANING_TEXT = 600
const LABEL = 80

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
    .map((r) => ({ ...r, at: titleRank(wordsRaw(r.item.title), query) }))
    .sort((a, b) => Number(a.item.archived) - Number(b.item.archived) || a.at - b.at || (a.at === 5 ? b.score - a.score : 0) || b.item.updatedAt - a.item.updatedAt)
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
  if (hit.kind === "meaning") return "meaning"
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

export const hitSeq = (hit: Hit): number | null => (hit.kind === "message" ? hit.m.seq : hit.kind === "older" ? hit.o.seq : null)

const label = (s: string): string => (s.trim() || "someone").slice(0, LABEL)

export function meaningPool(channel: Pick<Channel, "messages" | "nicknames" | "rooms">, older: OlderHit[]): MeaningPool {
  const items: MeaningPool["items"] = []
  const hits = new Map<number, Hit>()
  const add = (seq: number, from: string, where: Where, text: string, hit: Hit) => {
    const said = text.replace(/\s+/g, " ").trim().slice(0, MEANING_TEXT)
    if (!said || hits.has(seq) || items.length >= MEANING_MOST) return
    items.push({ id: seq, from: label(nickname(channel, from)), where: label(whereLabel(channel, where)), text: said })
    hits.set(seq, hit)
  }
  const recent = channel.messages
    .filter((m) => !m.system && !m.pending && m.seq > 0)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, MEANING_RECENT)
  for (const m of recent) add(m.seq, m.from, m.where, wordsPlain(m.text, channel.nicknames), { kind: "message", m })
  for (const o of older) add(o.seq, o.from, o.where, wordsPlain(wrote(o.text), channel.nicknames), { kind: "older", o })
  return { items, hits }
}
