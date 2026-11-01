import { describe, expect, test } from "bun:test"
import { checksSummary, ciOf, issueGroups, matches, prGroups } from "~/github/groups"
import type { Issue, PullRequest } from "~/model"

const pr = (number: number, over: Partial<PullRequest> = {}): PullRequest => ({
  repo: "o/r",
  number,
  title: `PR ${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  state: "open",
  checks: "none",
  ...over,
})
const issue = (number: number, over: Partial<Issue> = {}): Issue => ({
  repo: "o/r",
  number,
  title: `Issue ${number}`,
  url: `https://github.com/o/r/issues/${number}`,
  state: "open",
  at: number,
  ...over,
})

describe("the GitHub view groups what needs attention first", () => {
  test("open PRs split by CI, failing first; a required check not started counts as running", () => {
    const prs = [
      pr(1, { checks: "pass", ticks: { passed: 3, running: 0, failed: [] } }),
      pr(2, { checks: "pass", ticks: { passed: 2, running: 1, failed: [] } }),
      pr(3, { checks: "fail", ticks: { passed: 1, running: 0, failed: ["unit"] } }),
      pr(4),
      pr(5, { state: "merged", checks: "pass" }),
    ]
    expect(prs.map(ciOf)).toEqual(["ready", "running", "fail", "none", "ready"])
    expect(prGroups(prs, "open").map((g) => [g.key, g.rows.map((p) => p.number)])).toEqual([
      ["fail", [3]],
      ["running", [2]],
      ["ready", [1]],
      ["none", [4]],
    ])
    expect(prGroups([...prs, pr(6, { state: "closed" })], "closed").map((g) => [g.key, g.rows.map((p) => p.number)])).toEqual([
      ["merged", [5]],
      ["closed", [6]],
    ])
  })

  test("issues split by whether a task holds them, and closed ones by how they closed", () => {
    const issues = [issue(1), issue(2, { task: 9 }), issue(3, { state: "closed", reason: "completed" }), issue(4, { state: "closed", reason: "not_planned" })]
    expect(issueGroups(issues, "open").map((g) => [g.key, g.rows.map((i) => i.number)])).toEqual([
      ["free", [1]],
      ["held", [2]],
    ])
    expect(issueGroups(issues, "closed").map((g) => g.key)).toEqual(["done", "dropped"])
    expect(issueGroups([], "open")).toEqual([])
  })

  test("the filter matches every word against title, #number, author, branch and repo", () => {
    const p = pr(45, { title: "Shrink the bundle", by: "win-bot", branch: "T11-first-load" })
    expect(matches(p, "")).toBe(true)
    expect(matches(p, "#45")).toBe(true)
    expect(matches(p, "shrink WIN")).toBe(true)
    expect(matches(p, "first-load")).toBe(true)
    expect(matches(p, "shrink linux")).toBe(false)
  })

  test("the checks heading counts each state", () => {
    expect(
      checksSummary([
        { name: "a", state: "fail", word: "failed" },
        { name: "b", state: "waiting", word: "queued" },
        { name: "c", state: "running", word: "running" },
        { name: "d", state: "pass", word: "passed" },
        { name: "e", state: "skipped", word: "skipped" },
      ])
    ).toBe("1 failed · 2 running · 1 passed · 1 skipped")
  })
})
