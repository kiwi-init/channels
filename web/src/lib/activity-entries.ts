import type { Message } from "@kiwi/core/protocol.ts"
import { digestTask, type Tasks } from "./activity"
import { taskOfEvent } from "./task-cards"

export interface DigestPr {
  repo: string
  number: number
}

export type Activity = { kind: "task"; id: number; seqs: number[]; prs: DigestPr[] } | { kind: "github"; messages: Message[] } | { kind: "event"; m: Message }

const DIGEST_PRS = /(?:^| · )PR ([^·\n]+)/
const PR_REF = /([\w.-]+\/[\w.-]+)#(\d+)/g

export function digestPrs(body: string): DigestPr[] {
  const list = DIGEST_PRS.exec(body)?.[1] ?? ""
  return [...list.matchAll(PR_REF)].map((p) => ({ repo: p[1]!, number: Number(p[2]) }))
}

export function activityOf(run: readonly Message[], tasks: Tasks): Activity[] {
  const out: Activity[] = []
  const byTask = new Map<number, Extract<Activity, { kind: "task" }>>()
  let github: Extract<Activity, { kind: "github" }> | undefined
  for (const m of run) {
    const id = m.kind === "done" ? digestTask(m) : taskOfEvent(m)
    if (id !== null && tasks.has(id)) {
      let entry = byTask.get(id)
      if (!entry) {
        entry = { kind: "task", id, seqs: [], prs: [] }
        byTask.set(id, entry)
        out.push(entry)
      }
      entry.seqs.push(m.seq)
      if (m.kind === "done") for (const pr of digestPrs(m.body)) if (!entry.prs.some((p) => p.repo === pr.repo && p.number === pr.number)) entry.prs.push(pr)
    } else if (m.ev?.op === "github") {
      if (github) github.messages.push(m)
      else out.push((github = { kind: "github", messages: [m] }))
    } else out.push({ kind: "event", m })
  }
  return out
}
