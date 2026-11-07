import { afterAll, beforeEach, describe, expect, test } from "bun:test"

import { afkBackdrop } from "~/afk/backdrop"

interface Fake {
  afkScene?: () => Promise<{ html: string | null; first: boolean } | null>
  keepAfkScene?: (html: string) => Promise<string | null>
}

let kept: string[] = []
let served: string | null = "<!doctype html><title>meadow</title>"
const realFetch = globalThis.fetch
const realWindow = (globalThis as { window?: unknown }).window
const realLocation = (globalThis as { location?: unknown }).location

const use = (fake: Fake | null): void => {
  Object.assign(globalThis, { window: { kiwi: fake ? { getSnapshot: () => null, ...fake } : undefined } })
}

beforeEach(() => {
  kept = []
  served = "<!doctype html><title>meadow</title>"
  ;(globalThis as { location?: { href: string } }).location = { href: "views://internal/index.html" }
  globalThis.fetch = (async (url: URL | string) => {
    expect(String(url)).toBe("views://internal/afk-scene.html")
    return served === null ? new Response("", { status: 404 }) : new Response(served)
  }) as typeof fetch
})

afterAll(() => {
  globalThis.fetch = realFetch
  Object.assign(globalThis, { window: realWindow, location: realLocation })
})

const desktop = (got: { html: string | null; first: boolean } | null): Fake => ({
  afkScene: async () => got,
  keepAfkScene: async (html) => {
    kept.push(html)
    return html
  },
})

describe("which backdrop AFK shows", () => {
  test("in a browser, or on a desktop that can't keep frames from posting as the page, the built-in meadow", async () => {
    use(null)
    expect(await afkBackdrop()).toEqual({ kind: "meadow" })
    use(desktop(null))
    expect(await afkBackdrop()).toEqual({ kind: "meadow" })
  })

  test("the scene in ~/.kiwi/afk/scene.html, as it is", async () => {
    use(desktop({ html: "<p>mine</p>", first: false }))
    expect(await afkBackdrop()).toEqual({ kind: "scene", html: "<p>mine</p>" })
    expect(kept).toEqual([])
  })

  test("the first time, the bundled scene is kept as the file and shown", async () => {
    use(desktop({ html: null, first: true }))
    expect(await afkBackdrop()).toEqual({ kind: "scene", html: "<!doctype html><title>meadow</title>" })
    expect(kept).toEqual(["<!doctype html><title>meadow</title>"])
  })

  test("a file the person deleted stays deleted: the plain sky, and nothing is written back", async () => {
    use(desktop({ html: null, first: false }))
    expect(await afkBackdrop()).toEqual({ kind: "plain" })
    expect(kept).toEqual([])
  })

  test("a bundled scene that can't be read falls back to the meadow", async () => {
    served = null
    use(desktop({ html: null, first: true }))
    expect(await afkBackdrop()).toEqual({ kind: "meadow" })
    expect(kept).toEqual([])
  })
})
