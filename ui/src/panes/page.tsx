import { useMemo } from "react"

import { Body } from "~/chat/body"
import { useNames, useTaskIds } from "~/chat/conversation"
import { STATUS_WORDS } from "~/kit/bits"
import { openMessage } from "~/live/open-message"
import type { Channel } from "~/model"
import type { Doc } from "~/panes/store"
import { openImage } from "~/specs/comment-item"
import { wordsPlain, wordsRaw, wrote } from "~/words"
import { t } from "~/i18n/i18n"

const section = (title: string, lines: readonly string[], gap = "\n"): string => (lines.length ? `## ${title}\n\n${lines.join(gap)}` : "")

function taskPage(channel: Channel, id: number): string {
  const task = channel.tasks.find((x) => x.id === id)
  if (!task) return `# T${id}`
  const facts = [`**T${task.id}**`, STATUS_WORDS[task.status], task.owner ? `@${task.owner}` : "", task.pr ? `[PR #${task.pr.number}](${task.pr.url})` : ""].filter(Boolean)
  const steps = (task.steps ?? []).map((s) => `- [${s.state === "done" ? "x" : " "}] ${wordsRaw(s.words)}`)
  const notes = task.notes.map((n) => `**@${n.by}** ${wordsRaw(n.text)}`)
  return [`# ${wordsRaw(task.title)}`, facts.join(" · "), task.detail ? wordsRaw(task.detail) : "", section(t("panes.page.steps"), steps), section(t("panes.page.notes"), notes, "\n\n")]
    .filter(Boolean)
    .join("\n\n")
}

function specPage(channel: Channel, ask: number): string {
  const spec = channel.specs?.find((s) => s.ask === ask)
  if (!spec) return `# #${ask}`
  const title = wordsRaw(spec.title)
  const lines = wordsRaw(spec.text).split("\n")
  const first = lines.findIndex((l) => l.trim() !== "")
  const headed = first >= 0 && /^#\s+/.test(lines[first]!) && lines[first]!.replace(/^#\s+/, "").trim() === title
  const text = (headed ? lines.slice(first + 1) : lines).join("\n").trim()
  const facts = [`**#${spec.ask}**`, `v${spec.v}`, `@${spec.by}`]
  const tasks = channel.tasks.filter((x) => spec.tasks.includes(x.id)).map((x) => `- T${x.id} ${wordsRaw(x.title)} · ${STATUS_WORDS[x.status]}`)
  const comments = spec.comments.flatMap((seq) => channel.messages.filter((m) => m.seq === seq)).map((m) => `**@${m.from}** ${wordsRaw(m.text)}`)
  return [`# ${title}`, facts.join(" · "), text, section(t("panes.page.tasks"), tasks), section(t("panes.page.comments"), comments, "\n\n")].filter(Boolean).join("\n\n")
}

export function docName(channel: Channel, doc: Doc): string {
  if (doc.kind === "task") {
    const task = channel.tasks.find((x) => x.id === doc.task)
    return task ? `T${task.id} ${wordsPlain(task.title, channel.nicknames)}` : `T${doc.task}`
  }
  const spec = channel.specs?.find((s) => s.ask === doc.ask)
  return spec ? wordsPlain(spec.title, channel.nicknames) : `#${doc.ask}`
}

export function Page({ channel, doc }: { channel: Channel; doc: Doc }) {
  const names = useNames(channel)
  const tasks = useTaskIds(channel)
  const text = useMemo(() => wrote(doc.kind === "task" ? taskPage(channel, doc.task) : specPage(channel, doc.ask)), [channel, doc])
  return (
    <div className="page">
      <article className="page-text">
        <Body text={text} seq={Number.MAX_SAFE_INTEGER} names={names} tasks={tasks} onImage={openImage} onMessage={(seq) => openMessage(channel.code, seq)} />
      </article>
    </div>
  )
}
