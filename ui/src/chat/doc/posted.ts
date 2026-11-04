import type { Message } from "~/model"

type Posted = Pick<Message, "block" | "pending">

const posted = (m: Posted): boolean => m.block !== undefined && !m.pending

export const inFeed = (m: Posted, doc: boolean): boolean => !doc || m.block === undefined || posted(m)

export const postedBlocks = (messages: readonly Posted[]): ReadonlySet<string> => new Set(messages.flatMap((m) => (m.block !== undefined && posted(m) ? [m.block] : [])))
