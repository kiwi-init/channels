import { beforeAll, describe, expect, test } from "bun:test"
import { generateIdentity, sign, verify, type Identity } from "@kiwi/core/identity.ts"
import type { Event, Message } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { issuesOf, prsOf } from "~/live/map"

const ids: Record<string, Identity> = {}
let seq = 0
const log: Message[] = []

async function event(from: string, ev: Event): Promise<Message> {
  seq++
  const p = await sign(ids[from]!, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event", body: "", ts: seq, ev })
  const m = { ...p, seq, rts: seq, sigOk: await verify(p) }
  log.push(m)
  return m
}

let roster: Roster
const sha = "a".repeat(40)
const repo = "ojow/channels"

beforeAll(async () => {
  for (const n of ["jon", "mac"]) ids[n] = await generateIdentity(n)
  roster = [
    { name: "jon", pk: ids.jon!.pk, owner: true, at: 0, active: true, kind: "human" },
    { name: "mac", pk: ids.mac!.pk, owner: false, at: 1, active: true, kind: "agent" },
  ]
})

describe("the Pull requests and Issues tabs read the channel's GitHub state", () => {
  test("a PR carries each check, the required one GitHub hasn't started, and the task its branch names", async () => {
    await event("jon", { op: "branch.prefix.set", prefix: "T" })
    const add = await event("jon", { op: "task.add", title: "PR cards", owner: "mac" })
    await event("jon", { op: "github.rules", repo, branch: "main", required: ["ci-ok", "unit"], merge: ["squash"] })
    await event("jon", {
      op: "github",
      items: [
        {
          event: "pull_request",
          repo,
          action: "opened",
          number: 9,
          title: "PR cards",
          state: "open",
          merged: false,
          branch: `T${add.seq}-cards`,
          sha,
          by: "mac-bot",
          additions: 12,
          deletions: 3,
          files: 2,
          at: 1,
        },
        { event: "pull_request", repo, action: "closed", number: 7, title: "Old try", state: "closed", merged: true, branch: "old", at: 0 },
        { event: "check_run", repo, action: "completed", name: "unit", conclusion: "failure", sha, url: "https://github.com/ojow/channels/actions/runs/1", at: 2 },
        { event: "check_run", repo, action: "completed", name: "lint", conclusion: "success", sha, at: 3 },
        { event: "check_run", repo, action: "created", name: "shots", status: "in_progress", sha, at: 4 },
        { event: "check_run", repo, action: "completed", name: "perf", conclusion: "skipped", sha, at: 5 },
      ],
    })
    const prs = prsOf(fold(log, roster))
    expect(prs.map((p) => [p.number, p.state])).toEqual([
      [9, "open"],
      [7, "merged"],
    ])
    expect(prs[0]).toMatchObject({ branch: `T${add.seq}-cards`, by: "mac-bot", files: 2, additions: 12, deletions: 3, task: add.seq, checks: "fail" })
    expect(prs[0]?.list).toEqual([
      { name: "unit", state: "fail", word: "failed", required: true, url: "https://github.com/ojow/channels/actions/runs/1" },
      { name: "shots", state: "running", word: "running" },
      { name: "ci-ok", state: "waiting", word: "not started", required: true },
      { name: "lint", state: "pass", word: "passed" },
      { name: "perf", state: "skipped", word: "skipped" },
    ])
    expect(prs[1]?.task).toBeUndefined()
  })

  test("an issue knows the task made from it; open issues come first", async () => {
    await event("jon", {
      op: "github",
      items: [
        { event: "issues", repo, action: "closed", number: 3, title: "Old bug", state: "closed", reason: "not_planned", at: 6 },
        { event: "issues", repo, action: "opened", number: 4, title: "Cards look flat", state: "open", by: "jon", at: 7 },
      ],
    })
    const made = await event("jon", { op: "task.add", title: "Cards look flat", issue: { repo, number: 4 } })
    const issues = issuesOf(fold(log, roster))
    expect(issues.map((i) => [i.number, i.state, i.task])).toEqual([
      [4, "open", made.seq],
      [3, "closed", undefined],
    ])
    expect(issues[1]).toMatchObject({ reason: "not_planned", url: "https://github.com/ojow/channels/issues/3" })
  })
})
