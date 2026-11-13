import "~/i18n/en/github-later"
import type { GithubChore, GithubChoreError } from "@kiwi/core/github-health.ts"

import type { Key } from "~/i18n/en"
import { t } from "~/i18n/i18n"
import { ageOf, ago } from "~/kit/time"

const CHORES: Record<GithubChore, readonly [Key, Key]> = {
  status: ["github.health.status.failed", "github.health.status.failed.for"],
  drain: ["github.health.drain.failed", "github.health.drain.failed.for"],
  rules: ["github.health.rules.failed", "github.health.rules.failed.for"],
  releases: ["github.health.releases.failed", "github.health.releases.failed.for"],
  sync: ["github.health.sync.failed", "github.health.sync.failed.for"],
}

const choreTitle = (what: GithubChore, repo?: string): string => (repo ? t(CHORES[what][1], { repo }) : t(CHORES[what][0]))

function choreNext(message: string): string {
  if (/rate limit|\b429\b|too many/i.test(message)) return t("github.health.why.limit")
  if (/\b40[13]\b|bad credentials|not accessible|permission|forbidden|unauthori[sz]ed|installation/i.test(message)) return t("github.health.why.access")
  if (/failed to fetch|fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT|couldn't reach|unreachable/i.test(message)) return t("github.health.why.offline")
  return t("github.health.why.other")
}

export const choreLine = (e: GithubChoreError): string => t("github.health.line", { title: choreTitle(e.what, e.repo), when: since(e.at), next: choreNext(e.message) })

function since(at: number): string {
  const age = ageOf(at)
  return age === "now" ? t("github.health.just.now") : age === "recent" ? t("github.health.ago", { time: ago(at) }) : t("github.health.on", { date: ago(at) })
}
