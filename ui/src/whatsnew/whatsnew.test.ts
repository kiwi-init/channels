import { describe, expect, test } from "bun:test"

import { readFeatures } from "~/whatsnew/features"
import { installDay, newerThan } from "~/whatsnew/fresh"
import { readNotes } from "~/whatsnew/notes"

const md = `# What's new

Intro text.

## Search by meaning

- id: meaning
- since: 2026-11-25
- toggle: off

Find messages
by what they mean.

## No id here

Skipped.

## Faster feed

- id: feed

Scrolls smoother.
`

describe("WHATSNEW.md reads as features, each shown once", () => {
  test("each ## heading with an id is a feature; toggle: off marks one that starts off", () => {
    expect(readNotes(md)).toEqual([
      { id: "meaning", title: "Search by meaning", since: "2026-11-25", toggle: true, needs: null, body: "Find messages by what they mean." },
      { id: "feed", title: "Faster feed", since: null, toggle: false, needs: null, body: "Scrolls smoother." },
    ])
  })

  test("every feature in the real file has a title and a few lines", async () => {
    const md = await Bun.file(new URL("../../../WHATSNEW.md", import.meta.url)).text()
    const notes = readNotes(md)
    expect(notes).toHaveLength(md.split(/^## /m).length - 1)
    for (const n of notes) expect(n.body).not.toBe("")
  })

  test("search by meaning sends messages to Jev, so it starts off", async () => {
    const notes = readNotes(await Bun.file(new URL("../../../WHATSNEW.md", import.meta.url)).text())
    expect(notes.find((n) => n.id === "meaning")).toMatchObject({ toggle: true, needs: "typesafe-key" })
  })

  test("kept choices survive bad entries", () => {
    const store = (v: string | null) => ({ getItem: () => v, setItem: () => undefined })
    expect(readFeatures(store('{"on":["meaning","Bad Id",3],"seen":["meaning"]}'))).toEqual({ on: ["meaning"], seen: ["meaning"] })
    expect(readFeatures(store("not json"))).toEqual({ on: [], seen: [] })
    expect(readFeatures(store(null))).toEqual({ on: [], seen: [] })
  })
})

describe("a fresh install starts with everything seen", () => {
  const store = (init: Record<string, string>) => {
    const m = new Map(Object.entries(init))
    return {
      get length() {
        return m.size
      },
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    }
  }

  test("empty storage at boot is a fresh install: it keeps today as the day it started, across later launches", () => {
    const s = store({})
    expect(installDay(() => s, "2026-11-26")).toBe("2026-11-26")
    s.setItem("mc.appearance", "dark")
    expect(installDay(() => s, "2026-12-01")).toBe("2026-11-26")
  })

  test("storage kept from before has no install day, and no storage at all has none either", () => {
    expect(installDay(() => store({ "mc.appearance": "dark" }), "2026-11-26")).toBeNull()
    expect(
      installDay(() => {
        throw new Error("SecurityError")
      }, "2026-11-26")
    ).toBeNull()
  })

  test("a note shows when it landed after the install day, or always when there is none", () => {
    expect(newerThan("2026-11-25", "2026-11-26")).toBe(false)
    expect(newerThan("2026-11-26", "2026-11-26")).toBe(false)
    expect(newerThan(null, "2026-11-26")).toBe(false)
    expect(newerThan("2026-11-27", "2026-11-26")).toBe(true)
    expect(newerThan("2026-11-25", null)).toBe(true)
    expect(newerThan(null, null)).toBe(true)
  })
})
