import { describe, expect, test } from "bun:test"
import { generateIdentity, sign, verify } from "@kiwi/core/identity.ts"
import type { Message } from "@kiwi/core/protocol.ts"
import { fold, type Roster } from "@kiwi/core/state.ts"
import { messagesOf } from "~/live/map"
<<<<<<< HEAD
import { Shelf, showsAnew, spotOf, type Entry } from "~/live/pictures"
=======
import { showsAnew, spotOf, type Entry } from "~/live/pictures"
>>>>>>> origin/main

const jow = await generateIdentity("jow")
const roster: Roster = [{ name: "jow", pk: jow.pk, owner: true, at: 0, active: true, kind: "human" }]
const signed = await sign(jow, {
  v: 1 as const,
  id: "1",
  from: "jow",
  kind: "msg",
  body: "shots",
  ts: 1000,
  imgs: [
    { name: "dark.png", mime: "image/png", ref: { id: "a", key: "k", size: 10 } },
    { name: "logo.svg", mime: "image/svg+xml", ref: { id: "b", key: "k", size: 10 } },
    { name: "light.png", mime: "image/png", ref: { id: "c", key: "k", size: 10 } },
  ],
})
const log: Message[] = [{ ...signed, seq: 1, rts: 1000, sigOk: await verify(signed) }]
const state = fold(log, roster)
const ready = { url: "data:image/png;base64,AA", width: 2, height: 1, alt: "light.png" }

describe("feed images load when they come into view (T604)", () => {
  test("every raster image has a spot from the start, waiting until it loads; SVGs never show", () => {
    const got = messagesOf(state, log, "jow", new Map(), { get: (seq, i, alt) => (i === 2 ? ready : spotOf(undefined, `${seq}:${i}`, alt)) }, [])
    expect(got[0]?.images).toEqual([{ spot: "1:0", alt: "dark.png", state: "waiting" }, ready])
  })

  test("a spot says whether it is loading, failed or gone", () => {
    expect(spotOf({ state: "loading" }, "1:0", "a").state).toBe("waiting")
    expect(spotOf({ state: "failed" }, "1:0", "a").state).toBe("failed")
    expect(spotOf({ state: "gone" }, "1:0", "a").state).toBe("gone")
    expect(spotOf({ state: "ready", picture: ready }, "1:0", "a")).toBe(ready)
  })
})

describe("a picture's load recomputes the feed once, when it shows something new (T1795)", () => {
  const picture: Entry = { state: "ready", picture: ready }

  test("starting a load changes nothing on screen: the spot is already waiting", () => {
    expect(showsAnew(undefined, { state: "loading" })).toBe(false)
  })

  test("the loaded picture, a failure and a gone image each show something new", () => {
    expect(showsAnew({ state: "loading" }, picture)).toBe(true)
    expect(showsAnew({ state: "loading" }, { state: "failed" })).toBe(true)
    expect(showsAnew({ state: "loading" }, { state: "gone" })).toBe(true)
  })

  test("Retry on a failed image goes back to waiting, which the feed must show", () => {
    expect(showsAnew({ state: "failed" }, { state: "loading" })).toBe(true)
  })

  test("one load is one recompute where it used to be two", () => {
    const steps: [Entry | undefined, Entry][] = [
      [undefined, { state: "loading" }],
      [{ state: "loading" }, picture],
    ]
    expect(steps.filter(([was, next]) => showsAnew(was, next)).length).toBe(1)
  })
})
<<<<<<< HEAD

describe("the pictures a channel holds are bounded (T2472)", () => {
  test("past the limit, the picture seen longest ago that is off screen is shed", () => {
    const shelf = new Shelf(3)
    expect(shelf.put("1:0", false)).toEqual([])
    expect(shelf.put("2:0", false)).toEqual([])
    expect(shelf.put("3:0", false)).toEqual([])
    expect(shelf.put("4:0", false)).toEqual(["1:0"])
    expect(shelf.put("5:0", false)).toEqual(["2:0"])
  })

  test("a picture on screen is never shed, however old, and neither is the one just loaded", () => {
    const shelf = new Shelf(2)
    shelf.put("1:0", true)
    shelf.put("2:0", true)
    expect(shelf.put("3:0", true)).toEqual([])
    expect(shelf.put("4:0", false)).toEqual([])
    expect(shelf.put("1:0", false)).toEqual(["4:0"])
  })

  test("scrolling a picture back into view makes it the newest", () => {
    const shelf = new Shelf(2)
    shelf.put("1:0", false)
    shelf.put("2:0", false)
    shelf.put("1:0", true)
    shelf.put("1:0", false)
    expect(shelf.put("3:0", false)).toEqual(["2:0"])
  })

  test("a failed or gone picture leaves the shelf", () => {
    const shelf = new Shelf(1)
    shelf.put("1:0", false)
    shelf.drop("1:0")
    expect(shelf.put("2:0", false)).toEqual([])
  })

  test("a shed picture shows a waiting spot of its own size, and reloading it shows something new", () => {
    const shed: Entry = { state: "shed", width: 3232, height: 2148 }
    expect(spotOf(shed, "1:2", "light.png")).toEqual({ spot: "1:2", alt: "light.png", state: "waiting", width: 3232, height: 2148 })
    expect(showsAnew({ state: "ready", picture: ready }, shed)).toBe(true)
    const again: Entry = { state: "loading", width: 3232, height: 2148 }
    expect(showsAnew(shed, again)).toBe(false)
    expect(spotOf(again, "1:2", "light.png")).toEqual({ spot: "1:2", alt: "light.png", state: "waiting", width: 3232, height: 2148 })
    expect(showsAnew(again, { state: "ready", picture: ready })).toBe(true)
  })
})
=======
>>>>>>> origin/main
