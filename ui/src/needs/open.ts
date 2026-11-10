import type { Ask, Channel } from "~/model"

export const isOpen = (a: Ask): boolean => a.kind === "review" || a.kind === "spec" || a.kind === "quiet" || (!a.answer && !(a.kind === "question" && a.closed))

export const isIdle = (a: Ask): boolean => a.kind === "question" && !!a.idle && !a.answer

export const openAsks = (channel: Pick<Channel, "asks">): Ask[] => channel.asks.filter((a) => isOpen(a) && !isIdle(a))
