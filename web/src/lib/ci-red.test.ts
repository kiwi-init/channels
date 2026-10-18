import { describe, expect, test } from "bun:test"

import type { CiRed } from "@kiwi/core/ci-red.ts"

import { ciRedSend } from "./ci-red"

const red: CiRed = {
  seq: 9,
  repo: "ojow/channels",
  sha: "0123456789abcdef0123456789abcdef01234567",
  name: "test / unit",
  conclusion: "failure",
  branch: "T51-ci-red",
  url: "https://github.com/ojow/channels/runs/1",
  owner: "wren",
}

describe("what CI red posts", () => {
  test("a new task, for whoever pushed, with the commit, the check and the log excerpt", () => {
    const { opts } = ciRedSend(red, { excerpt: "(fail) quote\n##[error]Process completed with exit code 1.", url: null, from: "log" }, undefined)
    expect(opts.ev).toEqual({
      op: "task.add",
      title: "CI red: test / unit on T51-ci-red",
      owner: "wren",
      detail: "Commit ojow/channels@0123456789ab on T51-ci-red\ntest / unit failure: https://github.com/ojow/channels/runs/1\n\n```\n(fail) quote\n##[error]Process completed with exit code 1.\n```",
    })
  })

  test("with no one to give it to, it's left for the lead; with no log, it says where to look", () => {
    const { opts } = ciRedSend({ ...red, owner: undefined }, null, undefined)
    expect(opts.ev).toMatchObject({ op: "task.add" })
    expect(opts.ev && "owner" in opts.ev).toBe(false)
    expect(opts.ev && opts.ev.op === "task.add" ? opts.ev.detail : "").toEndWith("No log excerpt came back: open the check for the whole log.")
  })

  test("another red on a commit that already has its task is a note on it", () => {
    const { opts } = ciRedSend({ ...red, name: "repo / static" }, { excerpt: "web/x.ts:3: unused", url: null, from: "annotations" }, 40)
    expect(opts.ev).toEqual({ op: "task.update", task: 40, note: "Also red on this commit: repo / static (failure: https://github.com/ojow/channels/runs/1)\n\n```\nweb/x.ts:3: unused\n```" })
  })

  test("a log with a code fence in it can't close the excerpt's fence early", () => {
    const { opts } = ciRedSend(red, { excerpt: "```js\nboom\n```", url: null, from: "log" }, undefined)
    const detail = opts.ev && opts.ev.op === "task.add" ? (opts.ev.detail ?? "") : ""
    expect(detail.match(/```/g)).toHaveLength(2)
  })
})
