import type { GithubNote } from "@kiwi/core/protocol.ts"

export interface GithubPart {
  ref?: string
  url?: string
  text: string
}

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"])

const PR_WORD: Record<string, string> = { opened: "opened", reopened: "reopened", closed: "closed", ready_for_review: "ready for review", converted_to_draft: "back to draft", edited: "edited" }

function checkWord(i: GithubNote): string | null {
  if (!i.conclusion) return null
  if (i.conclusion === "success") return "passed"
  if (FAILED.has(i.conclusion)) return "failed"
  return i.conclusion.replace(/_/g, " ")
}

export function githubSummary(items: readonly GithubNote[]): GithubPart[] {
  const prs = new Map<string, GithubPart>()
  const issues = new Map<string, GithubPart>()
  const checks = new Map<string, string>()
  let pushes = 0
  let syncs = 0
  for (const i of items) {
    if (i.event === "pull_request" && i.number) {
      const key = `${i.repo}#${i.number}`
      const was = prs.get(key)
      const word = i.merged ? "merged" : PR_WORD[i.action ?? ""]
      if (i.action === "synchronize") syncs++
      const url = i.url ?? was?.url
      prs.set(key, { ref: `#${i.number}`, ...(url ? { url } : {}), text: word ?? was?.text ?? "updated" })
    } else if (i.event === "issues" && i.number) {
      issues.set(`${i.repo}#${i.number}`, { ref: `issue #${i.number}`, ...(i.url ? { url: i.url } : {}), text: i.action ?? "updated" })
    } else if ((i.event === "check_run" || i.event === "workflow_run") && i.name) {
      const word = checkWord(i)
      if (word) checks.set(i.name, word)
    } else if (i.event === "push") pushes++
  }
  const pushed = pushes || syncs
  return [...prs.values(), ...issues.values(), ...(pushed ? [{ text: pushed === 1 ? "1 push" : `${pushed} pushes` }] : []), ...[...checks].map(([name, word]) => ({ text: `${name} ${word}` }))]
}
