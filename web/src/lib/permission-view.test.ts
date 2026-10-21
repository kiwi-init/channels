import type { PermissionShown } from "@kiwi/core/permission.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import type { ChannelState, Member } from "@kiwi/core/state.ts"
import { describe, expect, test } from "bun:test"

import { ALLOW_ONCE, DENY, settledOf } from "./permission-settled"
import { permissionCode, permissionNotes, permissionTitle, visibleText } from "./permission-view"

const shown = (over: Partial<PermissionShown>): PermissionShown => ({ tool: "Bash", cwd: "/a", nonce: "nonce-123", expiresAt: 10_000, canAllow: true, ...over })

describe("what a permission row says", () => {
  test("its title follows the tool", () => {
    expect(permissionTitle(shown({ command: "ls" }))).toBe("wants to run a command")
    expect(permissionTitle(shown({ tool: "Edit", paths: ["a.ts"] }))).toBe("wants to edit a file")
    expect(permissionTitle(shown({ tool: "Write", paths: ["a.ts"] }))).toBe("wants to write a file")
    expect(permissionTitle(shown({ tool: "WebFetch", url: "https://x.dev/p" }))).toBe("wants to fetch a page")
    expect(permissionTitle(shown({ tool: "mcp__gh__merge", mcp: { server: "gh", tool: "merge", args: ["pr"] } }))).toBe("wants to use gh · merge")
  })

  test("it shows exactly what will run, with hidden and direction-changing characters made visible", () => {
    expect(permissionCode(shown({ command: "rm -rf dist && bun run build" }))).toBe("rm -rf dist && bun run build")
    expect(permissionCode(shown({ tool: "MultiEdit", paths: ["a.ts", "b.ts"] }))).toBe("a.ts\nb.ts")
    expect(permissionCode(shown({ tool: "mcp__gh__merge", mcp: { server: "gh", tool: "merge", args: ["pr", "method"], values: ["12", '"squash"'] } }))).toBe('gh.merge(pr: 12, method: "squash")')
    expect(permissionCode(shown({ tool: "mcp__gh__merge", mcp: { server: "gh", tool: "merge", args: ["pr"] } }))).toBe("gh.merge(pr)")
    expect(visibleText("echo safe‮;hs.lave‬")).toBe("echo safe\\u{202e};hs.lave\\u{202c}")
    expect(visibleText("a\u0007b​c")).toBe("a\\u{0007}b\\u{200b}c")
    expect(visibleText("line one\nline\ttwo")).toBe("line one\nline\ttwo")
  })

  test("it says when the sandbox is off, when it runs in the background, and when the app can't allow it", () => {
    expect(permissionNotes(shown({ command: "ls" }))).toEqual([])
    expect(permissionNotes(shown({ command: "ls", sandbox: "off", canAllow: false }))).toEqual(["It asks to run outside the sandbox: allow that in the terminal."])
    expect(permissionNotes(shown({ command: "ls", background: true }))).toEqual(["It runs in the background."])
    expect(permissionNotes(shown({ tool: "Edit", paths: ["a.ts"], replaced: "a", content: "b", replaceAll: true }))).toEqual(["It replaces every occurrence in the file."])
    expect(permissionNotes(shown({ tool: "Write", paths: ["a.ts"], canAllow: false }))).toEqual(["Too long to show all of it here: to allow it, answer in the terminal."])
  })
})

describe("how a permission was settled", () => {
  const member = (name: string, over: Partial<Member>): Member => ({ name, pk: name, scopes: [], owner: false, joined: 0, active: true, lastSeen: 0, messages: 0, ...over })
  const members = new Map<string, Member>([
    ["atlas", member("atlas", { kind: "agent", sponsor: { user: "u-ana", name: "Ana" } })],
    ["ana", member("ana", { kind: "human", sponsor: { user: "u-ana", name: "Ana" } })],
    ["jonatas", member("jonatas", { kind: "human", owner: true, sponsor: { user: "u-jo", name: "Jonatas" } })],
    ["win", member("win", { kind: "agent", sponsor: { user: "u-jo", name: "Jonatas" } })],
  ])
  const ask: Message = {
    seq: 5,
    id: "ask-5",
    from: "atlas",
    to: ["ana", "jonatas"],
    kind: "msg",
    body: "Permission",
    ts: 1,
    esc: true,
    sig: "sig-5",
    choices: [ALLOW_ONCE, DENY],
    permission: shown({ command: "ls" }),
  } as Message
  const reply = (seq: number, from: string, over: Partial<Message>): Message => ({ seq, id: `r-${seq}`, from, to: ["atlas"], kind: "msg", body: "", ts: seq, re: [5], ...over }) as Message
  const state = (replies: Message[]) => ({ members, trust: new Map([[5, "verified"], ...replies.map((r) => [r.seq, "verified"] as const)]) }) as unknown as ChannelState
  const settled = (replies: Message[]) => settledOf(ask, replies, state(replies))

  test("only the signed answer counts: Allow from the agent's own person, Deny from them or the owner", () => {
    expect(settled([])).toBeNull()
    expect(settled([reply(6, "ana", { body: ALLOW_ONCE })])).toBeNull()
    expect(settled([reply(6, "ana", { body: ALLOW_ONCE, perm: { ask: "ask-5", by: "atlas", of: "sig-5", allow: true } })])).toEqual({ answer: { allow: true, by: "ana", at: 6 } })
    expect(settled([reply(6, "ana", { perm: { ask: "another", by: "atlas", of: "sig-5", allow: true } })])).toBeNull()
    expect(settled([reply(6, "jonatas", { perm: { ask: "ask-5", by: "atlas", of: "sig-5", allow: true } })])).toBeNull()
    expect(settled([reply(6, "jonatas", { perm: { ask: "ask-5", by: "atlas", of: "sig-5", allow: false } })])).toEqual({ answer: { allow: false, by: "jonatas", at: 6 } })
  })

  test("the asker's own closing reply settles it, and says an earlier answer came too late", () => {
    expect(settled([reply(7, "atlas", { settled: "terminal" })])).toEqual({ closed: { kind: "terminal", at: 7 } })
    expect(settled([reply(6, "ana", { perm: { ask: "ask-5", by: "atlas", of: "sig-5", allow: false } }), reply(8, "atlas", { settled: "terminal" })])).toEqual({
      answer: { allow: false, by: "ana", at: 6 },
      closed: { kind: "terminal", at: 8 },
    })
    expect(settled([reply(7, "win", { settled: "ended" })])).toBeNull()
  })
})
