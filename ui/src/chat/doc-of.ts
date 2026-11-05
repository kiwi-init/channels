import { docThread } from "@kiwi/core/doc/threads.ts"

import type { Channel, Where } from "~/model"

export function docOf(channel: Pick<Channel, "directs">, where: Where): string | null {
  if (where.kind === "task") return docThread({ kind: "task", task: where.task })
  if (where.kind === "room") return docThread({ kind: "room", room: where.room })
  if (where.kind === "dm") return channel.directs.find((d) => d.with === where.with)?.doc ?? null
  return null
}
