import type { Check, Issue, PullRequest } from "~/model"

export type Shown = "open" | "closed"

export type GroupKey = "fail" | "running" | "ready" | "none" | "merged" | "closed" | "free" | "held" | "done" | "dropped"

export interface Group<T> {
  key: GroupKey
  label: string
  sub: string
  rows: T[]
}

const HEADS: Record<GroupKey, { label: string; sub: string }> = {
  fail: { label: "Checks failed", sub: "These can't merge until CI is green" },
  running: { label: "Checks running", sub: "Waiting on CI" },
  ready: { label: "Ready", sub: "Every check passed" },
  none: { label: "No checks yet", sub: "GitHub hasn't reported a check on these" },
  merged: { label: "Merged", sub: "Newest first" },
  closed: { label: "Closed without merging", sub: "Newest first" },
  free: { label: "Not picked up", sub: "No task holds these yet" },
  held: { label: "Being worked on", sub: "A task holds these" },
  done: { label: "Done", sub: "Closed as completed" },
  dropped: { label: "Not planned", sub: "Closed without doing them" },
}

export const isOpen = (x: { state: string }): boolean => x.state === "open" || x.state === "draft"

export function ciOf(pr: PullRequest): "fail" | "running" | "ready" | "none" {
  const t = pr.ticks
  if (t?.failed.length || pr.checks === "fail") return "fail"
  if (t?.running || pr.checks === "running") return "running"
  if ((t && t.passed > 0) || pr.checks === "pass") return "ready"
  return "none"
}

function grouped<T>(rows: readonly T[], order: readonly GroupKey[], keyOf: (row: T) => GroupKey): Group<T>[] {
  const out = new Map<GroupKey, T[]>(order.map((k) => [k, []]))
  for (const r of rows) out.get(keyOf(r))?.push(r)
  return order.flatMap((key) => {
    const list = out.get(key) ?? []
    return list.length ? [{ key, ...HEADS[key], rows: list }] : []
  })
}

export function prGroups(prs: readonly PullRequest[], shown: Shown): Group<PullRequest>[] {
  return shown === "open"
    ? grouped(prs.filter(isOpen), ["fail", "running", "ready", "none"], (p) => ciOf(p))
    : grouped(
        prs.filter((p) => !isOpen(p)),
        ["merged", "closed"],
        (p) => (p.state === "merged" ? "merged" : "closed")
      )
}

export function issueGroups(issues: readonly Issue[], shown: Shown): Group<Issue>[] {
  return shown === "open"
    ? grouped(issues.filter(isOpen), ["free", "held"], (i) => (i.task === undefined ? "free" : "held"))
    : grouped(
        issues.filter((i) => !isOpen(i)),
        ["done", "dropped"],
        (i) => (i.reason === "not_planned" ? "dropped" : "done")
      )
}

export function matches(item: { title: string; number: number; repo: string; by?: string; branch?: string }, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [item.title, `#${item.number}`, item.repo, item.by ?? "", item.branch ?? ""].join("\n").toLowerCase()
  return words.every((w) => hay.includes(w))
}

export function checksSummary(list: readonly Check[]): string {
  const n = (s: Check["state"]) => list.filter((c) => c.state === s).length
  return [
    [n("fail"), "failed"],
    [n("running") + n("waiting"), "running"],
    [n("pass"), "passed"],
    [n("skipped"), "skipped"],
  ]
    .flatMap(([count, word]) => (count ? [`${count} ${word}`] : []))
    .join(" · ")
}
