import type { Ask, Channel } from "~/model"

export const isOpen = (a: Ask): boolean => a.kind === "review" || a.kind === "spec" || a.kind === "quiet" || (!a.answer && !(a.kind === "question" && a.closed))

export const isIdle = (a: Ask): boolean => a.kind === "question" && !!a.idle && !a.answer

const waits = (a: Ask): boolean => isOpen(a) && !(isIdle(a) && a.kind === "question" && a.plain)

const byAt = (a: Ask, b: Ask): number => a.at - b.at

export const openAsks = (channel: Pick<Channel, "asks">): Ask[] => {
  const waiting = channel.asks.filter(waits)
  return [...waiting.filter((a) => !isIdle(a)).sort(byAt), ...waiting.filter(isIdle).sort(byAt)]
}

export const needsCount = (channel: Pick<Channel, "asks">): number => openAsks(channel).length
