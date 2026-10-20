import type { GithubCheckLog } from "@kiwi/core/client.ts"
import type { ChannelState } from "@kiwi/core/state.ts"
import { ciCommitLine, ciRedAfter, ciRedTitle, type CiRed } from "@kiwi/core/ci-red.ts"
import type { Message } from "@kiwi/core/protocol.ts"

import type { ChannelLink } from "./channel-ops"
import { drain } from "./github-queue"
import type { TaskSend } from "./task-actions"

const NO_LOG = "No log excerpt came back: open the check for the whole log."

function fenced(excerpt: string): string {
  return excerpt.trim() ? `\`\`\`\n${excerpt.replace(/```/g, "ˋˋˋ")}\n\`\`\`` : NO_LOG
}

export function ciRedSend(r: CiRed, log: GithubCheckLog | null, task: number | undefined): TaskSend {
  const where = `${r.conclusion}${r.url ? `: ${r.url}` : ""}`
  if (task !== undefined)
    return { body: `CI red: ${r.name}`, opts: { kind: "event", ev: { op: "task.update", task, note: `Also red on this commit: ${r.name} (${where})\n\n${fenced(log?.excerpt ?? "")}` } } }
  const detail = [`${ciCommitLine(r.repo, r.sha)}${r.branch ? ` on ${r.branch}` : ""}`, `${r.name} ${where}`, "", fenced(log?.excerpt ?? "")].join("\n")
  return { body: `added task ${ciRedTitle(r.name, r.branch)}`, opts: { kind: "event", ev: { op: "task.add", title: ciRedTitle(r.name, r.branch), detail, ...(r.owner ? { owner: r.owner } : {}) } } }
}

export interface Mark {
  get(): number | null
  set(seq: number): void
}

function ciRedToPost(mark: Mark, state: ChannelState, messages: Message[]): CiRed[] {
  const after = mark.get()
  if (after === null) {
    mark.set(state.head)
    return []
  }
  return ciRedAfter(state, messages, after)
}

export async function postCiReds(ch: Pick<ChannelLink, "githubCheckLog" | "send">, mark: Mark, state: ChannelState, messages: Message[]): Promise<void> {
  const opened = new Map<string, number>()
  await drain(
    ciRedToPost(mark, state, messages),
    async (r) => {
      const commit = `${r.repo.toLowerCase()}@${r.sha}`
      const log = await ch.githubCheckLog(r.repo, r.sha, r.name).catch(() => null)
      const { body, opts } = ciRedSend(r, log, r.task ?? opened.get(commit))
      const seq = await ch.send(body, opts)
      if (opts.ev?.op === "task.add") opened.set(commit, seq)
    },
    (seq) => mark.set(seq)
  )
}
