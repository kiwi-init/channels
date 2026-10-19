import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { generateIdentity, sign, verify } from "@kiwi/core/identity.ts"
import type { Event, Message } from "@kiwi/core/protocol.ts"
import { fold, prKey } from "@kiwi/core/state.ts"

mock.module("@/lib/avatars", () => ({ avatarUrl: () => "", robotUrl: () => "", robotFor: () => "blue" }))
const { TaskInline } = await import("./task-inline")

describe("a task opened inline", () => {
  test("its PR card names each check with how it went, and links to GitHub", async () => {
    const jon = await generateIdentity("jon")
    const roster = [{ name: "jon", pk: jon.pk, owner: true, at: 0, active: true, kind: "human" as const }]
    const ev = async (seq: number, e: Event): Promise<Message> => {
      const p = await sign(jon, { v: 1 as const, id: crypto.randomUUID(), from: "jon", kind: "event" as const, body: "", ts: seq, ev: e })
      return { ...p, seq, rts: seq, sigOk: await verify(p) }
    }
    const sha = "b".repeat(40)
    const log = [
      await ev(1, { op: "task.add", title: "Inline" }),
      await ev(2, {
        op: "github",
        items: [
          { event: "pull_request", repo: "o/r", number: 9, state: "open", branch: "T1-inline", sha, url: "https://github.com/o/r/pull/9", at: 1 },
          { event: "check_run", repo: "o/r", action: "completed", name: "test / unit", status: "completed", conclusion: "success", sha, at: 2 },
          { event: "check_run", repo: "o/r", action: "completed", name: "build / bundles", status: "completed", conclusion: "failure", sha, at: 3 },
          { event: "check_run", repo: "o/r", action: "created", name: "ci-ok", status: "queued", sha, at: 4 },
        ],
      }),
    ]
    const state = fold(log, roster)
    const pr = state.github.prs.get(prKey("o/r", 9))
    const html = renderToStaticMarkup(createElement(TaskInline, { pr, state, rows: [], composer: null, load: undefined, onDetails: () => undefined }))
    expect(html).toContain("PR #9")
    expect(html).toContain("T1-inline")
    for (const [name, word] of [
      ["test / unit", "success"],
      ["build / bundles", "failure"],
      ["ci-ok", "waiting"],
    ])
      expect(html).toMatch(new RegExp(`${name.replace(/\//g, "\\/")}<\\/span><span[^>]*>${word}`))
    expect(html).toContain('href="https://github.com/o/r/pull/9"')
    expect(html).not.toContain("See the diff")
  })
})
