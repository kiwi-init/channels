import type { Message, Where } from "~/model"
import { sameWhere } from "~/nav"

export interface Edit {
  seq: number
  was: string
}

export const lastOwn = (messages: readonly Message[], where: Where, inThread?: number): Message | undefined =>
  messages.findLast((m) => m.canChange && sameWhere(m.where, where) && (inThread === undefined ? m.inThread === undefined : m.inThread === inThread || m.seq === inThread))

export function nextEdit(now: Edit | null, m: Message | undefined, draft: string): { edit: Edit | null; text: string } | null {
  if (m) return now?.seq === m.seq ? null : { edit: { seq: m.seq, was: now ? now.was : draft }, text: m.text }
  return now ? { edit: null, text: now.was } : null
}
