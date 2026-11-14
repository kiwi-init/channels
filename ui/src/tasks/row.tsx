import "~/i18n/en/specs"
import "~/styles/tasks.css"

import { liveOf } from "~/doing"
import { t } from "~/i18n/i18n"
import { statusWord } from "~/kit/bits"
import { ago, lasting } from "~/kit/time"
import { memberOf, type Channel, type PullRequest, type Task } from "~/model"
import { nickname } from "~/names"
import { toned } from "~/panes/engine"
import { link } from "~/panes/page"
import { moverTag, quietFor } from "~/tasks/mover"
import { TONES } from "~/tasks/tones"
import { wordsPlain } from "~/words"

function stateOf(channel: Channel, task: Task): { text: string; tone: string } | null {
  const owner = task.owner ? memberOf(channel, task.owner) : undefined
  const live = owner && owner.load?.doing.includes(task.id) ? liveOf(owner) : null
  if (live && task.status !== "done") return { text: live.text, tone: live.busy ? "tone-doing" : "" }
  if (task.cancelled) return { text: t("tasks.row.cancelled"), tone: "" }
  if (task.status === "done" && task.release) return { text: t("tasks.row.shipped.in", { release: task.release }), tone: "" }
  if (!task.owner && task.leftBy && task.status !== "done") return { text: t("tasks.row.left", { who: nickname(channel, task.leftBy) }), tone: "" }
  if (task.status === "waiting") return { text: statusWord(task), tone: TONES.waiting }
  return null
}

function failedOf(pr: PullRequest): string | null {
  if (pr.state !== "open" && pr.state !== "draft") return null
  const failed = pr.ticks?.failed ?? []
  if (failed.length) return t("tasks.row.failed", { checks: failed.join(", ") })
  return pr.checks === "fail" ? t("tasks.row.checks.failed") : null
}

export function taskLine(channel: Channel, task: Task, now: number): string {
  const state = stateOf(channel, task)
  const failed = task.pr ? failedOf(task.pr) : null
  const move = moverTag(channel, task, now)
  const quiet = quietFor(task, now)
  const parts = [
    toned(`T${task.id}`),
    state ? toned(state.text, state.tone) : "",
    move ? toned(move) : "",
    quiet ? toned(t("tasks.row.quiet", { time: lasting(quiet.ms) }), "tone-alert") : "",
    task.pr ? toned(t("tasks.row.pr", { number: String(task.pr.number) }), failed ? "tone-alert" : undefined, failed ?? undefined) : "",
    toned(ago(task.updatedAt)),
  ].filter(Boolean)
  const said = task.mentions ? ` \`kiwi:n:${task.mentions}\`` : ""
  return `- ${link(wordsPlain(task.title, channel.nicknames), `kiwi-task:${task.id}`)}\\\n  ${parts.join(" · ")}${said}`
}
