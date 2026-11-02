import { whereLabel } from "~/chat/search-hits"
import { ANYONE } from "@kiwi/channel/task-actions.ts"
import type { Channel, TaskEvent } from "~/model"
import { nickname } from "~/names"

export const someone = (channel: Channel, name: string): string => (name === channel.you ? "you" : nickname(channel, name))

export function moveWords(channel: Channel, e: TaskEvent): string {
  const to = e.to ? (e.to === ANYONE ? "anyone" : someone(channel, e.to)) : ""
  switch (e.what) {
    case "created":
      return e.to ? `created it for ${to}` : "created it"
    case "took":
      return "took it"
    case "assigned":
      return `gave it to ${to}`
    case "unassigned":
      return "unassigned it"
    case "started":
      return "started it"
    case "blocked":
      return "marked it blocked"
    case "reopened":
      return "reopened it"
    case "review":
      return e.round ? `sent it for review · round ${e.round}` : "sent it for review"
    case "approved":
      return e.round ? `approved round ${e.round}` : "approved it"
    case "rejected":
      return e.round ? `sent round ${e.round} back` : "sent it back"
    case "done":
      return "marked it done"
    case "cancelled":
      return "cancelled it"
    case "reviewer":
      return e.to === ANYONE ? "opened its review to anyone who hasn't worked on it" : e.to === e.by ? "took the review" : e.to ? `asked ${to} to review it` : "cleared its reviewer"
    case "renamed":
      return "renamed it"
    case "proof":
      return "added proof"
    case "checkpoint":
      return "saved a checkpoint"
    case "note":
      return "added a note"
    case "mention":
      return `mentioned it in ${e.where ? whereLabel(channel, e.where).replace(/^# /, "#").replace(/^@ /, "a message to ") : "a message"}`
  }
}
