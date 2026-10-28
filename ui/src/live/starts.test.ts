import { describe, expect, mock, test } from "bun:test"

import type { TerminalsStatus } from "@kiwi/core/terminals.ts"

const calls: string[] = []
let folders = ["/Users/jow/www/channels"]
let status: TerminalsStatus | null = { prefer: "app", launch: "on", bypass: "off", terminals: [] }
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
}
mock.module("@/lib/secrets", () => ({ bridge: () => fake }))
const { addStartFolder, allowNewAgents, allowRemoteBypass, loadStarts, removeStartFolder, startsNow } = await import("~/live/starts")

describe("Settings > Agents saves where and how agents start", () => {
  test("it shows this computer's own folders and switches, not a made-up list", async () => {
    await loadStarts()
    expect(startsNow()).toEqual({ folders: ["/Users/jow/www/channels"], launch: true, bypass: false })
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

  test("with kiwi not answering, the page has nothing to show", async () => {
    status = null
    await loadStarts()
    expect(startsNow()).toBeNull()
  })
})
