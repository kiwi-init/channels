import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { blobUrl, ModIcon, modIconUrl } from "~/mods/icon"
import { showModReads } from "~/mods/served"

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" onload="globalThis.__iconRan='onload'"><script>globalThis.__iconRan='script'</script><rect width="8" height="8"/></svg>`

const ran = (): unknown => (globalThis as { __iconRan?: unknown }).__iconRan

describe("a mod's icon", () => {
  test("an SVG with a script is only ever an image from a blob: the page gets no SVG, script or handler, and nothing in it runs", async () => {
    showModReads({ modIcon: () => Promise.resolve({ type: "image/svg+xml", data: btoa(SVG) }), modDetails: () => Promise.resolve(null), setModSetting: () => Promise.resolve([]) })
    const url = await modIconUrl("probe", "1a2b")
    expect(url).toMatch(/^blob:/)
    const html = renderToStaticMarkup(<ModIcon name="probe" icon="1a2b" />)
    expect(html).toEndWith(`<img class="mod-icon is-md" src="${url}" alt="" draggable="false"/>`)
    expect(html).not.toMatch(/<svg|<script|onload/i)
    const blob = await fetch(url ?? "").then((r) => r.blob())
    expect(blob.type).toBe("image/svg+xml")
    expect(await blob.text()).toBe(SVG)
    expect(ran()).toBeUndefined()
  })

  test("a new icon replaces the old one's blob, and a type the app didn't set is never shown", async () => {
    showModReads({ modIcon: () => Promise.resolve({ type: "image/png", data: btoa("\x89PNG\r\n\x1a\n") }), modDetails: () => Promise.resolve(null), setModSetting: () => Promise.resolve([]) })
    const was = await modIconUrl("probe", "1a2b")
    const now = await modIconUrl("probe", "3c4d")
    expect(now).not.toBe(was)
    expect(renderToStaticMarkup(<ModIcon name="probe" icon="1a2b" />)).toContain("is-letter")
    expect(blobUrl({ type: "text/html" as "image/png", data: btoa("<script>top.x=1</script>") })).toBeNull()
  })

  test("without an icon, or until it loads, a mod shows its first letter", () => {
    expect(renderToStaticMarkup(<ModIcon name="weather" />)).toBe('<span class="mod-icon is-letter is-md" aria-hidden="true">W</span>')
    expect(renderToStaticMarkup(<ModIcon name="radar" icon="not-loaded" size="lg" />)).toBe('<span class="mod-icon is-letter is-lg" aria-hidden="true">R</span>')
  })
})
