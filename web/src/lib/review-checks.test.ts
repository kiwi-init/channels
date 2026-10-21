import { describe, expect, test } from "bun:test"

import { generateIdentity, sign, verify } from "@kiwi/core/identity.ts"
import type { Event, Message } from "@kiwi/core/protocol.ts"
import { fold } from "@kiwi/core/state.ts"
import { diffLineClass } from "./diff"
import { checkedUpTo, checksToPost, issuesToPost, linksToPost, tasksToClose } from "./review-checks"
import { closeFromGithub } from "./task-actions"

describe("posting review checks from the owner's app", () => {
  test("the first look marks where the channel is and posts nothing old; later verdicts are due", async () => {
    const jon = await generateIdentity("jon")
    const rev = await generateIdentity("rev")
    const roster = [
      { name: "jon", pk: jon.pk, owner: true, at: 0, active: true, kind: "human" as const },
      { name: "rev", pk: rev.pk, owner: false, at: 1, active: true, kind: "agent" as const },
    ]
    let seq = 0
    const ev = async (id: typeof jon, from: string, e: Event): Promise<Message> => {
      seq++
      const p = await sign(id, { v: 1 as const, id: crypto.randomUUID(), from, kind: "event" as const, body: "", ts: seq, ev: e })
      return { ...p, seq, rts: seq, sigOk: await verify(p) }
    }
    const log = [await ev(jon, "jon", { op: "repos.set", repos: ["o/r"] }), await ev(jon, "jon", { op: "task.add", title: "x", review: "rev" })]
    log.push(await ev(jon, "jon", { op: "task.update", task: 2, state: "review", at: "d".repeat(40) }))
    const room = `room-${crypto.randomUUID()}`
    expect(checksToPost(room, fold(log, roster), log)).toEqual([])
    expect(checkedUpTo(room)).toBe(3)
    log.push(await ev(rev, "rev", { op: "task.update", task: 2, state: "done", verdict: "approved", round: 1 }))
    expect(checksToPost(room, fold(log, roster), log)).toMatchObject([{ repo: "o/r", sha: "d".repeat(40), verdict: "approved", task: 2 }])
  })

  test("with Write to GitHub on, a PR on branch T<n>-… is linked back once, and not on the first look", async () => {
    const jon = await generateIdentity("jon")
    const roster = [{ name: "jon", pk: jon.pk, owner: true, at: 0, active: true, kind: "human" as const }]
    let seq = 0
    const ev = async (e: Event): Promise<Message> => {
      seq++
      const p = await sign(jon, { v: 1 as const, id: crypto.randomUUID(), from: "jon", kind: "event" as const, body: "", ts: seq, ev: e })
      return { ...p, seq, rts: seq, sigOk: await verify(p) }
    }
    const room = `room-${crypto.randomUUID()}`
    const log = [await ev({ op: "task.add", title: "Link back" }), await ev({ op: "github.write.set", on: true })]
    expect(linksToPost(room, fold(log, roster))).toEqual([])
    log.push(await ev({ op: "github", items: [{ event: "pull_request", repo: "o/r", action: "opened", number: 5, state: "open", branch: "T1-link", at: 1 }] }))
    expect(linksToPost(room, fold(log, roster))).toEqual([{ repo: "o/r", number: 5, task: 1, seq: 3, body: "Linked to Kiwi task T1" }])
    expect(checkedUpTo(room, "prLinks")).toBe(2)
  })

  test("an issue's task and the issue close each other, once, and nothing from before the first look", async () => {
    const jon = await generateIdentity("jon")
    const roster = [{ name: "jon", pk: jon.pk, owner: true, at: 0, active: true, kind: "human" as const }]
    let seq = 0
    const ev = async (e: Event, body = ""): Promise<Message> => {
      seq++
      const p = await sign(jon, { v: 1 as const, id: crypto.randomUUID(), from: "jon", kind: "event" as const, body, ts: seq, ev: e })
      return { ...p, seq, rts: seq, sigOk: await verify(p) }
    }
    const room = `room-${crypto.randomUUID()}`
    const log = [await ev({ op: "task.add", title: "Old", issue: { repo: "o/r", number: 1 } }), await ev({ op: "task.add", title: "New", issue: { repo: "o/r", number: 2 } })]
    log.push(await ev({ op: "task.update", task: 1, state: "done" }))
    expect(issuesToPost(room, fold(log, roster))).toEqual([])
    expect(tasksToClose(room, fold(log, roster))).toEqual([])
    log.push(await ev({ op: "github", items: [{ event: "issues", repo: "o/r", action: "closed", number: 2, state: "closed", reason: "not_planned", by: "jow", at: 1 }] }))
    let s = fold(log, roster)
    expect(issuesToPost(room, s)).toEqual([])
    const due = tasksToClose(room, s)
    expect(due).toEqual([{ task: 2, seq: 4, cancelled: true, note: "o/r#2 closed as not planned on GitHub by @jow" }])
    const { body, opts } = closeFromGithub(s.tasks.get(2)!, due[0]!)
    expect(body).toBe("T2 cancelled: o/r#2 closed as not planned on GitHub by @jow")
    log.push(await ev(opts.ev!, body))
    s = fold(log, roster)
    expect(s.tasks.get(2)).toMatchObject({ state: "done", cancelled: true })
    expect(issuesToPost(room, s)).toEqual([])
    expect(checkedUpTo(room, "issueCloses")).toBe(3)
    expect(checkedUpTo(room, "issueTasks")).toBe(3)
  })

  test("diff lines: additions and removals marked at the edge, headers bold, hunks quiet", () => {
    expect(diffLineClass("+added")).toContain("border-live")
    expect(diffLineClass("-removed")).toContain("border-alert")
    expect(diffLineClass("+++ b/file")).toContain("font-semibold")
    expect(diffLineClass("@@ -1 +1 @@")).toBe("text-ink-3")
  })
})
