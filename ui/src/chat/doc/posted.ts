import type { Message } from "~/model"

type Posted = Pick<Message, "block" | "pending">

const posted = (m: Posted): boolean => m.block !== undefined && !m.pending

export const inFeed = (m: Posted, doc: boolean): boolean => !doc || m.block === undefined || posted(m)

export const postedBlocks = (messages: readonly Posted[]): ReadonlySet<string> => new Set(messages.flatMap((m) => (m.block !== undefined && posted(m) ? [m.block] : [])))

type Lines = ReadonlySet<string | undefined>

export const docLines = (list: readonly Pick<Message, "block" | "fromDoc">[]): Lines => new Set(list.filter((m) => m.fromDoc).map((m) => m.block))

export const arrivals = <M extends Pick<Message, "seq" | "block">>(list: readonly M[], after: number, lines: Lines): M[] => list.filter((m) => m.seq > after && !lines.has(m.block))
