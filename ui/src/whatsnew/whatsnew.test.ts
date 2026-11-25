import { describe, expect, test } from "bun:test"

import { readFeatures } from "~/whatsnew/features"
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
