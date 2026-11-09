import "~/i18n/en/needs"
import { whereLabel } from "~/chat/search-hits"
import { ANYONE } from "@kiwi/channel/task-actions.ts"
import { t } from "~/i18n/i18n"
import type { Channel, TaskEvent } from "~/model"
import { nickname } from "~/names"

export const someone = (channel: Channel, name: string): string => (name === channel.you ? t("panels.moves.you") : nickname(channel, name))

function mentioned(channel: Channel, e: TaskEvent): string {
  if (!e.where) return t("panels.moves.mention")
  const label = whereLabel(channel, e.where)
  if (label.startsWith("@ ")) return t("panels.moves.mention.dm", { name: label.slice(2) })
  return t("panels.moves.mention.in", { where: label.replace(/^# /, "#") })
}

export function moveWords(channel: Channel, e: TaskEvent): string {
  const to = e.to ? (e.to === ANYONE ? t("panels.moves.anyone") : someone(channel, e.to)) : ""
  switch (e.what) {
    case "created":
      return e.to ? t("panels.moves.created.for", { name: to }) : t("panels.moves.created")
    case "took":
      return t("panels.moves.took")
    case "assigned":
      return t("panels.moves.assigned", { name: to })
    case "unassigned":
      return t("panels.moves.unassigned")
    case "started":
      return t("panels.moves.started")
    case "blocked":
      return t("panels.moves.blocked")
    case "reopened":
      return t("panels.moves.reopened")
    case "review":
      return e.round ? t("panels.moves.review.round", { round: e.round }) : t("panels.moves.review")
    case "approved":
      return e.round ? t("panels.moves.approved.round", { round: e.round }) : t("panels.moves.approved")
    case "rejected":
      return e.round ? t("panels.moves.rejected.round", { round: e.round }) : t("panels.moves.rejected")
    case "done":
      return t("panels.moves.done")
    case "cancelled":
      return t("panels.moves.cancelled")
    case "reviewer":
      return e.to === ANYONE
        ? t("panels.moves.reviewer.anyone")
        : e.to === e.by
          ? t("panels.moves.reviewer.took")
          : e.to
            ? t("panels.moves.reviewer.asked", { name: to })
            : t("panels.moves.reviewer.cleared")
    case "renamed":
      return t("panels.moves.renamed")
    case "proof":
      return t("panels.moves.proof")
    case "checkpoint":
      return t("panels.moves.checkpoint")
    case "note":
      return t("panels.moves.note")
    case "mention":
      return mentioned(channel, e)
  }
}
