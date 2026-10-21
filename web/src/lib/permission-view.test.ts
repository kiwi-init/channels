import { describe, expect, test } from "bun:test"

import { ALLOW_ONCE, DENY, permissionOf, permissionShown, permissionTitle, settledOf, visibleText } from "./permission-view"

describe("what a permission row says", () => {
  test("its title follows the tool", () => {
    expect(permissionTitle({ tool: "Bash", command: "ls", cwd: "/a" })).toBe("wants to run a command")
    expect(permissionTitle({ tool: "Edit", paths: ["a.ts"], cwd: "/a" })).toBe("wants to edit a file")
    expect(permissionTitle({ tool: "MultiEdit", paths: ["a.ts", "b.ts"], cwd: "/a" })).toBe("wants to edit files")
    expect(permissionTitle({ tool: "WebFetch", url: "https://x.dev/p", cwd: "/a" })).toBe("wants to fetch a page")
    expect(permissionTitle({ tool: "mcp__gh__merge", mcp: { server: "gh", tool: "merge", args: ["pr"] }, cwd: "/a" })).toBe("wants to use gh · merge")
    expect(permissionTitle({ tool: "Task", cwd: "/a" })).toBe("wants to use Task")
  })

  test("it shows exactly what will run, with hidden and direction-changing characters made visible", () => {
    expect(permissionShown({ tool: "Bash", command: "rm -rf dist && bun run build", cwd: "/a" })).toBe("rm -rf dist && bun run build")
    expect(permissionShown({ tool: "MultiEdit", paths: ["a.ts", "b.ts"], cwd: "/a" })).toBe("a.ts\nb.ts")
    expect(permissionShown({ tool: "mcp__gh__merge", mcp: { server: "gh", tool: "merge", args: ["pr", "method"] }, cwd: "/a" })).toBe("gh.merge(pr, method)")
    expect(visibleText("echo safe‮;hs.lave‬")).toBe("echo safe\\u{202e};hs.lave\\u{202c}")
    expect(visibleText("a\u0007b​c")).toBe("a\\u{0007}b\\u{200b}c")
    expect(visibleText("line one\nline\ttwo")).toBe("line one\nline\ttwo")
  })
})

describe("how a permission was settled", () => {
  const ask = { from: "atlas" }
  const may = (name: string) => name === "jonatas" || name === "ana"

  test("a person allowed to answer settles it with a choice; anyone else's reply or another text doesn't", () => {
    expect(settledOf(ask, [], may)).toBeNull()
    expect(settledOf(ask, [{ seq: 5, from: "win", body: ALLOW_ONCE, ts: 1 }], may)).toBeNull()
    expect(settledOf(ask, [{ seq: 5, from: "jonatas", body: "sure", ts: 1 }], may)).toBeNull()
    expect(settledOf(ask, [{ seq: 5, from: "jonatas", body: ALLOW_ONCE, ts: 9 }], may)).toEqual({ kind: "allowed", by: "jonatas", at: 9 })
    expect(settledOf(ask, [{ seq: 5, from: "ana", body: DENY, ts: 9 }], may)).toEqual({ kind: "denied", by: "ana", at: 9 })
  })

  test("the asker's own closing reply settles it as the terminal, a timeout or the session ending; the first settlement wins", () => {
    expect(settledOf(ask, [{ seq: 6, from: "atlas", body: "answered in the terminal", ts: 4, settled: "terminal" }], may)).toEqual({ kind: "terminal", at: 4 })
    expect(settledOf(ask, [{ seq: 6, from: "atlas", body: "x", ts: 4, settled: "made-up" }], may)).toBeNull()
    expect(
      settledOf(
        ask,
        [
          { seq: 8, from: "jonatas", body: ALLOW_ONCE, ts: 8 },
          { seq: 7, from: "atlas", body: "no answer from the app", ts: 7, settled: "timeout" },
        ],
        may
      )
    ).toEqual({ kind: "timeout", at: 7 })
  })
})

describe("reading a message's permission", () => {
  test("a well-formed one comes through with only its known fields; anything else is not a permission", () => {
    expect(permissionOf({ permission: { tool: "Bash", command: "ls", description: "List", cwd: "/a", nonce: "n", extra: 1 } })).toEqual({ tool: "Bash", command: "ls", description: "List", cwd: "/a" })
    expect(permissionOf({ permission: { tool: "MultiEdit", paths: ["a.ts", 3, "b.ts"], cwd: "/a" } })).toEqual({ tool: "MultiEdit", paths: ["a.ts", "b.ts"], cwd: "/a" })
    expect(permissionOf({ permission: { tool: "mcp__gh__merge", mcp: { server: "gh", tool: "merge", args: ["pr", 1] }, cwd: "/a" } })?.mcp).toEqual({ server: "gh", tool: "merge", args: ["pr"] })
    expect(permissionOf({})).toBeNull()
    expect(permissionOf({ permission: "Bash" })).toBeNull()
    expect(permissionOf({ permission: { command: "ls", cwd: "/a" } })).toBeNull()
    expect(permissionOf({ permission: { tool: "Bash", command: "x".repeat(4001), cwd: "/a" } })?.command).toBeUndefined()
  })
})
