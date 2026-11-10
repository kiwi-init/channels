import { describe, expect, test } from "bun:test"

import type { Folder } from "~/model"
import { railMenu } from "~/shell/rail-menu"

const at = { x: 60, y: 120 }
const games: Folder = { id: "f", name: "games", codes: ["b"], open: true }

function rail(folders: Folder[], muted: string[] = [], member = false) {
  const opened: string[] = []
  const saved: Folder[][] = []
  const mutes: [string, boolean][] = []
  return {
    saved,
    mutes,
    opened,
    settings: member ? (code: string) => void opened.push(code) : null,
    folders,
    title: (code: string) => `#${code}`,
    muted: (code: string) => muted.includes(code),
    setMute: (code: string, on: boolean) => void mutes.push([code, on]),
    save: (next: Folder[]) => void saved.push(next),
  }
}

const labels = (menu: ReturnType<typeof railMenu>) => menu?.groups.flat().map((i) => i.label)

describe("the rail's menus are the app's one context menu (T1826)", () => {
  test("a channel outside a folder offers Mute, each folder to add it to, and a new folder", () => {
    const r = rail([games])
    const menu = railMenu({ kind: "channel", code: "a" }, at, r)
    expect(menu?.label).toBe("#a")
    expect([menu?.x, menu?.y]).toEqual([60, 120])
    expect(labels(menu)).toEqual(["Mute channel", "Add to games", "New folder"])
    menu?.groups[0]?.[0]?.run()
    expect(r.mutes).toEqual([["a", true]])
    menu?.groups[0]?.[1]?.run()
    expect(r.saved[0]?.[0]?.codes).toEqual(["b", "a"])
    menu?.groups[0]?.[2]?.run()
    expect(r.saved[1]?.at(-1)).toMatchObject({ codes: ["a"], open: true })
  })

  test("a muted channel inside a folder offers Unmute and taking it out", () => {
    const r = rail([games], ["b"])
    const menu = railMenu({ kind: "channel", code: "b" }, at, r)
    expect(labels(menu)).toEqual(["Unmute channel", "Take out of games"])
    menu?.groups[0]?.[0]?.run()
    expect(r.mutes).toEqual([["b", false]])
    menu?.groups[0]?.[1]?.run()
    expect(r.saved[0]?.some((f) => f.codes.includes("b"))).toBe(false)
  })

  test("a folder offers its name to edit and Ungroup", () => {
    const r = rail([games])
    const menu = railMenu({ kind: "folder", id: "f" }, at, r)
    expect(menu?.field).toMatchObject({ value: "games", max: 40 })
    expect(labels(menu)).toEqual(["Ungroup"])
    menu?.field?.save("  arcade  ")
    expect(r.saved[0]?.[0]?.name).toBe("arcade")
    menu?.groups[0]?.[0]?.run()
    expect(r.saved[1]).toEqual([])
  })

  test("a channel you are in also offers Channel settings, last and in its own group", () => {
    const r = rail([games], [], true)
    const menu = railMenu({ kind: "channel", code: "a" }, at, r)
    expect(menu?.groups.map((g) => g.map((i) => i.label))).toEqual([["Mute channel", "Add to games", "New folder"], ["Channel settings"]])
    menu?.groups[1]?.[0]?.run()
    expect(r.opened).toEqual(["a"])
  })

  test("a channel you are waiting to join has no settings to offer, and no empty group", () => {
    expect(railMenu({ kind: "channel", code: "a" }, at, rail([games]))?.groups).toHaveLength(1)
  })

  describe("Invite, Leave and Delete need to know if you own the channel (T3486)", () => {
    const groups = (own: boolean | undefined) => {
      const went: string[] = []
      const r = { ...rail([], [], true), own, invite: (code: string) => void went.push(`invite ${code}`), end: (code: string) => void went.push(`end ${code}`) }
      const menu = railMenu({ kind: "channel", code: "a" }, at, r)
      return { went, menu, labels: menu?.groups.map((g) => g.map((i) => i.label)) }
    }

    test("a channel you own offers Invite people, and Delete last behind its own separator", () => {
      const { labels, menu, went } = groups(true)
      expect(labels).toEqual([["Mute channel", "New folder"], ["Channel settings", "Invite people"], ["Delete channel…"]])
      menu?.groups[1]?.[1]?.run()
      menu?.groups[2]?.[0]?.run()
      expect(went).toEqual(["invite a", "end a"])
    })

    test("a channel you are a member of offers Leave, and no Invite", () => {
      const { labels, menu, went } = groups(false)
      expect(labels).toEqual([["Mute channel", "New folder"], ["Channel settings"], ["Leave this channel…"]])
      menu?.groups[2]?.[0]?.run()
      expect(went).toEqual(["end a"])
    })

    test("a channel that hasn't loaded since this was stored offers neither", () => {
      expect(groups(undefined).labels).toEqual([["Mute channel", "New folder"], ["Channel settings"]])
    })

    test("a tile you are waiting to join offers none of them, whatever is stored", () => {
      const r = { ...rail([]), own: true, invite: () => {}, end: () => {} }
      expect(railMenu({ kind: "channel", code: "a" }, at, r)?.groups).toHaveLength(1)
    })
  })

  test("a folder that is gone opens nothing", () => {
    expect(railMenu({ kind: "folder", id: "x" }, at, rail([]))).toBeNull()
  })
})
