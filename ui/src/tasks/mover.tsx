import "~/i18n/en/specs"
import "~/styles/tasks.css"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { lasting, useNow } from "~/kit/time"
import type { Channel, MoveFor, RunTrouble, Task } from "~/model"
import { TASK_TICK_MS } from "~/tasks/tick"
import { nickname } from "~/names"
import { wordsPlain } from "~/words"

const MOVES: Readonly<Record<MoveFor, Key>> = {
  work: "tasks.move.work",
  start: "tasks.move.start",
  assign: "tasks.move.assign",
  review: "tasks.move.review",
  route: "tasks.move.route",
  revise: "tasks.move.revise",
  answer: "tasks.move.answer",
  land: "tasks.move.land",
  reset: "tasks.move.reset",
}

export const TROUBLES: Readonly<Record<RunTrouble, Key>> = { failed: "tasks.move.trouble.failed", unseen: "tasks.move.trouble.unseen", overran: "tasks.move.trouble.overran" }

const DUE: readonly (Key | null)[] = [null, "tasks.quiet.step.1", "tasks.quiet.step.2", "tasks.quiet.step.3"]

export function moverWords(channel: Channel, task: Task, now: number): string | null {
  const mover = task.mover
  if (!mover) return null
  if (mover.kind === "waiting") return t("tasks.move.waiting", { count: mover.ahead, who: nickname(channel, mover.owner) })
  if (mover.kind === "nobody") return t("tasks.move.nobody")
  if (mover.kind === "run") return t("tasks.move.run", { time: lasting(mover.due - now), who: nickname(channel, mover.behind) })
  if (mover.kind === "hold") return t("tasks.move.hold", { time: lasting(mover.until - now), reason: wordsPlain(mover.reason, channel.nicknames) })
  const words = t(MOVES[mover.move], { who: nickname(channel, mover.name), reviewer: mover.reviewer ? nickname(channel, mover.reviewer) : "" })
  return mover.trouble ? t("tasks.move.with.trouble", { move: words, trouble: t(TROUBLES[mover.trouble]) }) : words
}

export function moverTag(channel: Channel, task: Task, now: number): string | null {
  const mover = task.mover
  if (!mover) return null
  if (mover.kind === "nobody") return null
  if (mover.kind === "member" && mover.name === task.owner && mover.move !== "revise" && !mover.trouble) return null
  return mover.kind === "waiting" ? t("tasks.row.waiting", { count: mover.ahead }) : moverWords(channel, task, now)
}

export function quietFor(task: Task, now: number): { ms: number; due: string | null } | null {
  const quiet = task.quiet
  if (!quiet || now < quiet.from) return null
  const key = DUE[quiet.step]
  return { ms: now - quiet.since, due: key ? t(key) : null }
}

export function quietWords(channel: Channel, task: Task, now: number): string | null {
  const quiet = quietFor(task, now)
  if (!quiet || !task.quiet) return null
  const words = t("tasks.quiet.with", { time: lasting(quiet.ms), who: nickname(channel, task.quiet.with) })
  return quiet.due ? t("tasks.quiet.due", { quiet: words, due: quiet.due }) : words
}

export const useTaskNow = (): number => useNow(TASK_TICK_MS)

export const seesQuiet = (channel: Channel): boolean => channel.youOwn || channel.lead === channel.you

export function quietTasks(channel: Channel, now: number): Task[] {
  return channel.tasks.filter((task) => !task.archived && quietFor(task, now) !== null).sort((a, b) => (a.quiet?.since ?? 0) - (b.quiet?.since ?? 0))
}
