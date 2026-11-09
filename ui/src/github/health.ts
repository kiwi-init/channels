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

export const choreTitle = (what: GithubChore, repo?: string): string => (repo ? t(CHORES[what][1], { repo }) : t(CHORES[what][0]))

export const choreLine = (e: GithubChoreError): string => t("github.health.line", { title: choreTitle(e.what, e.repo), when: since(e.at), message: e.message })

export function since(at: number): string {
  const age = ageOf(at)
  return age === "now" ? t("github.health.just.now") : age === "recent" ? t("github.health.ago", { time: ago(at) }) : t("github.health.on", { date: ago(at) })
}
