import type { Ask, Channel } from "~/model"

export const isOpen = (a: Ask): boolean => a.kind === "review" || a.kind === "spec" || !a.answer

export const isIdle = (a: Ask): boolean => a.kind === "question" && !!a.idle && !a.answer

export const openAsks = (channel: Channel): Ask[] => channel.asks.filter((a) => isOpen(a) && !isIdle(a))
