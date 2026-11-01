import { GENERAL_ROOM, type Message as Wire } from "@kiwi/core/protocol.ts"
import { preview } from "~/chat/preview"
import { mentions } from "~/live/mention"
import type { Channel, Prefs } from "~/model"

const NOTE_BODY = 200

const isDecision = (m: Wire): boolean => (m.kind === "ask" || m.kind === "blocking") && !m.permission && !m.handoff

export function worthTelling(m: Wire, me: string, notify: Prefs["notify"], decides: boolean): boolean {
  if (m.kind === "event" || m.from === me || notify === "none") return false
  if (notify === "all") return true
  return !!m.to?.includes(me) || mentions(m.body, me) || (decides && !!m.esc && isDecision(m))
}

export const elsewhere = (): boolean => document.hidden || !document.hasFocus()

export function drawerNews(channel: Pick<Channel, "rooms" | "directs">): "loud" | "quiet" | null {
  if (channel.rooms.some((r) => r.mentions > 0) || channel.directs.some((d) => d.unread > 0)) return "loud"
  return channel.rooms.some((r) => r.unread > 0) ? "quiet" : null
}

export const channelLink = (code: string): string => `kiwi://join/${encodeURIComponent(code)}`

export const messageLink = (code: string, seq: number): string => `${channelLink(code)}?m=${seq}`

export function messageOfLink(url: string): number | null {
  const found = /[?&]m=(\d{1,15})(?:[&#]|$)/.exec(url)
  const seq = found ? Number(found[1]) : Number.NaN
  return Number.isSafeInteger(seq) && seq > 0 ? seq : null
}

export const messageHash = (code: string, seq: number): string => `#${encodeURIComponent(code)}?m=${seq}`

export function hashTarget(hash: string): { hash: string; seq: number | null } {
  const at = hash.indexOf("?")
  return at < 0 ? { hash, seq: null } : { hash: hash.slice(0, at), seq: messageOfLink(hash.slice(at)) }
}

export type NotePlace = { kind: "room"; name: string } | { kind: "task"; task: number } | { kind: "dm" } | { kind: "thread" }

export const wirePlace = (m: Pick<Wire, "room" | "task" | "dm">): NotePlace =>
  m.dm ? { kind: "dm" } : m.task !== undefined ? { kind: "task", task: m.task } : { kind: "room", name: m.room ?? GENERAL_ROOM }

export type Rooted = { kind: "root"; m: Wire; below: Wire } | { kind: "missing"; seq: number }

export function rootOf(m: Wire, known: ReadonlyMap<number, Wire>): Rooted {
  let at = m
  let below = m
  for (;;) {
    const parent = at.re?.[0]
    if (at.kind === "event" || parent === undefined || parent >= at.seq) return { kind: "root", m: at, below }
    const up = known.get(parent)
    if (!up) return { kind: "missing", seq: parent }
    below = at
    at = up
  }
}

function eventTask(m: Wire): number | null {
  const ev = m.kind === "event" ? m.ev : undefined
  if (!ev) return null
  if (ev.op === "task.add") return m.seq
  if (ev.op === "task.update" || ev.op === "task.claim" || ev.op === "task.first") return ev.task
  return null
}

export function rootedPlace(root: { m: Wire; below: Wire }): NotePlace {
  const task = eventTask(root.m)
  if (task !== null) return { kind: "task", task }
  if (root.m.kind === "event") return { kind: "room", name: root.below.room ?? GENERAL_ROOM }
  return wirePlace(root.m)
}

const placeText = (place: NotePlace): string => {
  switch (place.kind) {
    case "dm":
      return "a direct message"
    case "task":
      return `T${place.task}`
    case "thread":
      return "a thread"
    case "room":
      return `#${place.name}`
  }
}

export function noteTitle(m: Wire, me: string, from: string, channel: string, place: NotePlace): string {
  const needsYou = isDecision(m) && (!!m.to?.includes(me) || !!m.esc)
  return `${from}${needsYou ? " needs you" : ""} in ${channel} · ${placeText(place)}`
}

export function noteBody(text: string, max = NOTE_BODY): string {
  const plain = preview(text)
  if (plain.length <= max) return plain
  const cut = plain.slice(0, max - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

export function lastWorth(messages: readonly Wire[], me: string, notify: Prefs["notify"], decides: boolean): Wire | null {
  return messages.findLast((m) => m.sigOk && worthTelling(m, me, notify, decides)) ?? null
}

export interface Heads {
  start(code: string, seq: number): void
  head(code: string, seq: number): void
}

export function heardHeads(skip: (code: string) => boolean, read: (code: string, after: number, upTo: number) => Promise<void>): Heads {
  const told = new Map<string, number>()
  const reading = new Map<string, number>()
  const head = (code: string, seq: number): void => {
    const prev = told.get(code)
    if (prev !== undefined && seq <= prev) return
    const wanted = reading.get(code)
    if (wanted !== undefined) return void reading.set(code, Math.max(wanted, seq))
    told.set(code, seq)
    if (prev === undefined || skip(code)) return
    reading.set(code, seq)
    void read(code, prev, seq)
      .catch(() => {})
      .finally(() => {
        const next = reading.get(code) ?? seq
        reading.delete(code)
        if (next > seq) head(code, next)
      })
  }
  const start = (code: string, seq: number): void => {
    if (!told.has(code)) told.set(code, seq)
  }
  return { start, head }
}
