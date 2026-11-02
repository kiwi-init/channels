import type { GithubChore, GithubChoreError } from "@kiwi/core/github-health.ts"

import { ago } from "~/kit/time"

const CHORES: Record<GithubChore, string> = {
  status: "Checking the GitHub App",
  drain: "Reading GitHub's news",
  rules: "Reading the merge rules",
  releases: "Reading the releases",
  sync: "Fetching pull requests and issues",
}

export const choreTitle = (what: GithubChore, repo?: string): string => `${CHORES[what]}${repo ? ` for ${repo}` : ""} failed`

export const choreLine = (e: GithubChoreError): string => `${choreTitle(e.what, e.repo)} ${since(e.at)}: ${e.message}`

export function since(at: number): string {
  const when = ago(at)
  return when === "now" ? "just now" : /^\d+[mhd]$/.test(when) ? `${when} ago` : `on ${when}`
}
