import { describe, expect, test } from "bun:test"

import type { GithubNote } from "@kiwi/core/protocol.ts"
import { githubSummary } from "./github-line"

const n = (over: Partial<GithubNote>): GithubNote => ({ event: "push", repo: "o/r", at: 1, ...over })

describe("GitHub's news folds into one line", () => {
  test("a PR's latest word, its pushes and each check's result, in that order", () => {
    const items = [
      n({ event: "pull_request", action: "opened", number: 371, url: "https://github.com/o/r/pull/371" }),
      n({ event: "push", branch: "T12" }),
      n({ event: "pull_request", action: "synchronize", number: 371 }),
      n({ event: "push", branch: "T12" }),
      n({ event: "check_run", action: "completed", name: "ci-ok", conclusion: "failure" }),
      n({ event: "push", branch: "T12" }),
      n({ event: "check_run", action: "completed", name: "ci-ok", conclusion: "success" }),
    ]
    expect(githubSummary(items)).toEqual([{ ref: "#371", url: "https://github.com/o/r/pull/371", text: "opened" }, { text: "3 pushes" }, { text: "ci-ok passed" }])
  })

  test("a merge wins over the PR's earlier words; syncs count as pushes when no push came", () => {
    const items = [n({ event: "pull_request", action: "synchronize", number: 5 }), n({ event: "pull_request", action: "closed", merged: true, number: 5 })]
    expect(githubSummary(items)).toEqual([{ ref: "#5", text: "merged" }, { text: "1 push" }])
  })

  test("issues say what happened to them; a check still running says nothing yet", () => {
    const items = [n({ event: "issues", action: "closed", number: 12, url: "https://github.com/o/r/issues/12" }), n({ event: "workflow_run", action: "requested", name: "CI" })]
    expect(githubSummary(items)).toEqual([{ ref: "issue #12", url: "https://github.com/o/r/issues/12", text: "closed" }])
  })
})
