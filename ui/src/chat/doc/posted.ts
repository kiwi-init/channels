import type { Message } from "~/model"

type Posted = Pick<Message, "block" | "pending">

const posted = (m: Posted): boolean => m.block !== undefined && !m.pending

export const inFeed = (m: Posted, doc: boolean): boolean => !doc || m.block === undefined || posted(m)

export const postedBlocks = (messages: readonly Posted[]): ReadonlySet<string> => new Set(messages.flatMap((m) => (m.block !== undefined && posted(m) ? [m.block] : [])))

export const docLines = (list: readonly Pick<Message, "block" | "fromDoc">[]): ReadonlySet<string> => new Set(list.flatMap((m) => (m.fromDoc && m.block !== undefined ? [m.block] : [])))

export const arrivals = <M extends Pick<Message, "seq" | "block">>(list: readonly M[], after: number, lines: ReadonlySet<string>): M[] =>
  list.filter((m) => m.seq > after && (m.block === undefined || !lines.has(m.block)))
