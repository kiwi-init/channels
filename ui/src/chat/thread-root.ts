import type { Message } from "~/model"

export function threadRoot(messages: readonly Pick<Message, "seq" | "inThread">[], opened: number, focus?: number): { seq: number; focus: number | undefined } {
  const inside = messages.find((m) => m.seq === opened)?.inThread
  return inside === undefined ? { seq: opened, focus } : { seq: inside, focus: focus ?? opened }
}
