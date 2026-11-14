import type { Channel, Message } from "~/model.ts"
import { wrote } from "~/words.ts"
import { SPOILER_MESSAGES } from "./markdown-samples.ts"

export function withMarkdownNodes(channel: Channel): Channel {
  const messages: Message[] = SPOILER_MESSAGES.map((text, i) => ({ seq: 801 + i, from: "atlas", at: Date.now() - (10 - i) * 60_000, where: { kind: "room", room: "general" }, text: wrote(text) }))
  messages.push({ seq: 813, from: "jow", at: Date.now() - 60_000, where: { kind: "room", room: "general" }, text: wrote("The reply preview keeps its existing plain-text contract."), replyTo: 801 })
  return { ...channel, messages: [...channel.messages.filter((m) => m.where.kind !== "room" || m.where.room !== "general"), ...messages] }
}
