import { describe, expect, mock, test } from "bun:test"

import type { TerminalsStatus } from "@kiwi/core/terminals.ts"

const calls: string[] = []
const terminals: TerminalsStatus["terminals"] = [{ id: "rex", name: "Rex", found: true, running: true, helpers: "off" }]
let status: TerminalsStatus | null = { terminals }

const fake = {
  terminals: async () => status,
  terminalHelpers: async (id: "rex", to: "on" | "off") => (
    calls.push(`${id} helpers ${to}`),
    status && (status = { ...status, terminals: status.terminals.map((t) => (t.id === id ? { ...t, helpers: to } : t)) })
  ),
}
mock.module("@kiwi/secrets/secrets.ts", () => ({ bridge: () => fake }))
const { loadStarts, setTerminalHelpers, startsNow } = await import("~/live/starts")

describe("Settings > Agents shows this computer's terminals", () => {
  test("it shows this computer's own terminals, not a made-up list", async () => {
    await loadStarts()
    expect(startsNow()).toEqual({ terminals })
  })

  test("downloading Rex's helpers is saved on this computer", async () => {
    await setTerminalHelpers("rex", true)
    expect(calls.splice(0)).toEqual(["rex helpers on"])
    expect(startsNow()?.terminals.find((t) => t.id === "rex")?.helpers).toBe("on")
  })

  test("with kiwi not answering, the page has nothing to show", async () => {
    status = null
    await loadStarts()
    expect(startsNow()).toBeNull()
  })
})
