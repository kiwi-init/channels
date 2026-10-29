import { describe, expect, mock, test } from "bun:test"

import type { TerminalsStatus } from "@kiwi/core/terminals.ts"

const calls: string[] = []
let folders = ["/Users/jow/www/channels"]
const terminals: TerminalsStatus["terminals"] = [
  { id: "app", name: "Terminal", found: true, running: true, helpers: null },
  { id: "rex", name: "Rex", found: true, running: true, helpers: "off" },
]
let status: TerminalsStatus | null = { prefer: "app", launch: "on", bypass: "off", terminals }
let chosen: string | null = "/Users/jow/www/landing"

const fake = {
  terminals: async () => status,
  launchRoots: async () => folders,
  chooseFolder: async () => (calls.push("choose"), chosen),
  setLaunchRoot: async (dir: string, to: "add" | "remove") => {
    calls.push(`${to} ${dir}`)
    folders = to === "add" ? [...folders, dir] : folders.filter((f) => f !== dir)
    return folders
  },
  setLaunches: async (to: "on" | "off") => (calls.push(`launch ${to}`), status && (status = { ...status, launch: to })),
  setRemoteBypass: async (to: "on" | "off") => (calls.push(`bypass ${to}`), status && (status = { ...status, bypass: to })),
  terminalHelpers: async (id: "rex" | "tmux", to: "on" | "off") => (
    calls.push(`${id} helpers ${to}`),
    status && (status = { ...status, terminals: status.terminals.map((t) => (t.id === id ? { ...t, helpers: to } : t)) })
  ),
  terminalPrefer: async (id: "app" | "rex" | "tmux") => (calls.push(`prefer ${id}`), status && (status = { ...status, prefer: id })),
}
mock.module("@kiwi/secrets/secrets.ts", () => ({ bridge: () => fake }))
const { addStartFolder, allowNewAgents, allowRemoteBypass, loadStarts, preferTerminal, removeStartFolder, setTerminalHelpers, startsNow } = await import("~/live/starts")

describe("Settings > Agents saves where and how agents start", () => {
  test("it shows this computer's own folders and switches, not a made-up list", async () => {
    await loadStarts()
    expect(startsNow()).toEqual({ folders: ["/Users/jow/www/channels"], launch: true, bypass: false, prefer: "app", terminals })
  })

  test("Add a folder… asks for one and keeps it; Remove takes it out", async () => {
    await addStartFolder()
    expect(calls.splice(0)).toEqual(["choose", "add /Users/jow/www/landing"])
    expect(startsNow()?.folders).toEqual(["/Users/jow/www/channels", "/Users/jow/www/landing"])
    await removeStartFolder("/Users/jow/www/channels")
    expect(calls.splice(0)).toEqual(["remove /Users/jow/www/channels"])
    expect(startsNow()?.folders).toEqual(["/Users/jow/www/landing"])
  })

  test("a cancelled folder picker changes nothing", async () => {
    chosen = null
    await addStartFolder()
    expect(calls.splice(0)).toEqual(["choose"])
    expect(startsNow()?.folders).toEqual(["/Users/jow/www/landing"])
  })

  test("both switches are saved on this computer", async () => {
    await allowRemoteBypass(true)
    await allowNewAgents(false)
    expect(calls.splice(0)).toEqual(["bypass on", "launch off"])
    expect(startsNow()).toMatchObject({ launch: false, bypass: true })
  })

  test("downloading Rex's helpers lets new agents open in Rex", async () => {
    await setTerminalHelpers("rex", true)
    await preferTerminal("rex")
    expect(calls.splice(0)).toEqual(["rex helpers on", "prefer rex"])
    expect(startsNow()?.prefer).toBe("rex")
    expect(startsNow()?.terminals.find((t) => t.id === "rex")?.helpers).toBe("on")
  })

  test("with kiwi not answering, the page has nothing to show", async () => {
    status = null
    await loadStarts()
    expect(startsNow()).toBeNull()
  })
})
