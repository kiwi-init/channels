import "~/i18n/en/github-later"
import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import type { Check, Issue, PullRequest } from "~/model"

export type Shown = "open" | "closed"

export type GroupKey = "fail" | "running" | "ready" | "none" | "merged" | "closed" | "free" | "held" | "done" | "dropped"

export interface Group<T> {
  key: GroupKey
  label: string
  rows: T[]
}

const HEADS: Record<GroupKey, Key> = {
  fail: "github.groups.fail",
  running: "github.groups.running",
  ready: "github.groups.ready",
  none: "github.groups.none",
  merged: "github.groups.merged",
  closed: "github.groups.closed",
  free: "github.groups.free",
  held: "github.groups.held",
  done: "github.groups.done",
  dropped: "github.groups.dropped",
}

export const isOpen = (x: { state: string }): boolean => x.state === "open" || x.state === "draft"

export function ciOf(pr: PullRequest): "fail" | "running" | "ready" | "none" {
  const ticks = pr.ticks
  if (ticks?.failed.length || pr.checks === "fail") return "fail"
  if (ticks?.running || pr.checks === "running") return "running"
  if ((ticks && ticks.passed > 0) || pr.checks === "pass") return "ready"
  return "none"
}

function grouped<T>(rows: readonly T[], order: readonly GroupKey[], keyOf: (row: T) => GroupKey): Group<T>[] {
  const out = new Map<GroupKey, T[]>(order.map((k) => [k, []]))
  for (const r of rows) out.get(keyOf(r))?.push(r)
  return order.flatMap((key) => {
    const list = out.get(key) ?? []
    return list.length ? [{ key, label: t(HEADS[key]), rows: list }] : []
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
  const counts: [number, Key][] = [
    [n("fail"), "github.groups.summary.failed"],
    [n("running") + n("waiting"), "github.groups.summary.running"],
    [n("pass"), "github.groups.summary.passed"],
    [n("skipped"), "github.groups.summary.skipped"],
  ]
  return counts.flatMap(([count, key]) => (count ? [t(key, { count })] : [])).join(" · ")
}
