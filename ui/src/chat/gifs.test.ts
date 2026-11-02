import { afterEach, describe, expect, test } from "bun:test"
import { gifFile, loadCatalog, peekCatalog, readCatalog, type Gif } from "~/chat/gifs"

const real = globalThis.fetch
afterEach(() => {
  globalThis.fetch = real
})

const reply = (body: string, type: string): typeof fetch => Object.assign(async () => new Response(body, { headers: { "content-type": type } }), { preconnect: real.preconnect })

const trailer: Gif = { reaction: "ok", name: "trailer", feeling: "nice ok", key: "ok/trailer" }

describe("GIFs come from what the relay serves", () => {
  test("a catalog keeps well-formed entries, groups them by feeling, and finds them by key", () => {
    const c = readCatalog([
      { reaction: "ok", name: "trailer", feeling: "nice ok" },
      { reaction: "ok", name: "cat", feeling: "cat ok" },
      { reaction: "nope", name: "no-way", feeling: "nope" },
      { reaction: "../etc", name: "x", feeling: "bad path" },
      { reaction: "ok", name: "", feeling: "no name" },
      "junk",
    ])
    expect(c?.groups.map((g) => [g.reaction, g.items.map((i) => i.name)])).toEqual([
      ["ok", ["trailer", "cat"]],
      ["nope", ["no-way"]],
    ])
    expect(c?.byKey("ok/trailer")?.feeling).toBe("nice ok")
    expect(c?.byKey("../etc/x")).toBeUndefined()
  })

  test("anything but a non-empty list is no catalog", () => {
    expect(readCatalog("<!doctype html>")).toBeNull()
    expect(readCatalog({})).toBeNull()
    expect(readCatalog([])).toBeNull()
  })

  test("a relay that answers with its single-page fallback (200 text/html) has no GIFs", async () => {
    await loadCatalog("https://html.example", reply("<!doctype html><html></html>", "text/html"))
    expect(peekCatalog("https://html.example")).toBeNull()
  })

  test("a relay that serves the index has GIFs", async () => {
    await loadCatalog("https://ok.example", reply(JSON.stringify([{ reaction: "ok", name: "trailer", feeling: "nice ok" }]), "application/json"))
    expect(peekCatalog("https://ok.example")?.byKey("ok/trailer")?.name).toBe("trailer")
  })

  test("a page answered in place of a GIF is never attached", async () => {
    globalThis.fetch = reply("<!doctype html>", "text/html")
    await expect(gifFile("https://html.example", trailer)).rejects.toThrow("not a GIF")
    globalThis.fetch = reply("RIFF....WEBP", "image/webp")
    const file = await gifFile("https://img.example", trailer)
    expect([file.name, file.type]).toEqual(["ok-trailer.webp", "image/webp"])
  })
})
