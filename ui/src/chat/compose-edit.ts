import type { Message, Where } from "~/model"
import { sameWhere } from "~/nav"

export const lastOwn = (messages: readonly Message[], where: Where, inThread?: number): Message | undefined =>
  messages.findLast((m) => m.canChange && sameWhere(m.where, where) && (inThread === undefined ? m.inThread === undefined : m.inThread === inThread || m.seq === inThread))
